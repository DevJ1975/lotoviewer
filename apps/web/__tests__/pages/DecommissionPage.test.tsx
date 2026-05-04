import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { supabase } from '@/lib/supabase'
import DecommissionPage from '@/app/decommission/page'
import type { Equipment } from '@/lib/types'

// ─── Module mocks ────────────────────────────────────────────────────────────
// Debounce → identity so search filters apply synchronously in tests. The
// 200ms delay in production doesn't change any branch coverage here.
vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: <T,>(v: T) => v,
}))

// Haptics touch navigator.vibrate, which isn't in jsdom and isn't under test.
vi.mock('@/lib/platform', () => ({
  haptic: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

// ─── Supabase chain builder ──────────────────────────────────────────────────
// The page uses two different chains on `supabase.from('loto_equipment')`:
//   fetch  : .select('*').order('equipment_id', {ascending: true})       → await
//   update : .update(...).eq|in('equipment_id', ...).select('equipment_id') → await
// One `from` call must return a builder that supports BOTH. A shared thenable
// approach works because both chains terminate in an awaited value with
// { data, error } shape. The `updateResponses` queue lets individual tests
// script per-call PATCH results (needed for undo scenarios).
type UpdateResp = {
  // The page selects `equipment_id, decommissioned` after the PATCH so it
  // can verify the persisted value matches what was written. Mock data
  // mirrors that shape — both fields optional so individual tests can
  // omit either one.
  data:  Array<{ equipment_id: string; decommissioned?: boolean }> | null
  error: { message: string } | null
}

function installSupabase(opts: {
  fetchRows?:       Equipment[]
  fetchError?:      { message: string } | null
  updateResponses?: UpdateResp[]
} = {}) {
  const rows  = opts.fetchRows  ?? []
  const ferr  = opts.fetchError ?? null
  const queue: UpdateResp[] = [...(opts.updateResponses ?? [])]

  // Fetch path
  const fetchEnd: Record<string, unknown> = {
    then: (r?: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: ferr }).then(r),
  }
  const order = vi.fn().mockReturnValue(fetchEnd)
  const selectFetch = vi.fn().mockReturnValue({ order })

  // Update path
  const updateSelect = vi.fn().mockImplementation(() => ({
    then: (r?: (v: unknown) => unknown) => {
      const next = queue.shift() ?? { data: [{ equipment_id: '__default__' }], error: null }
      return Promise.resolve(next).then(r)
    },
  }))
  const eq = vi.fn().mockReturnValue({ select: updateSelect })
  const inFn = vi.fn().mockReturnValue({ select: updateSelect })
  const update = vi.fn().mockReturnValue({ eq, in: inFn })

  vi.mocked(supabase.from).mockReturnValue({
    select: selectFetch,
    update,
  } as unknown as ReturnType<typeof supabase.from>)

  return { selectFetch, order, update, eq, in: inFn, updateSelect, queue }
}

// ─── Fixture helper ──────────────────────────────────────────────────────────
function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001',
    description:  'Motor',
    department:   'Alpha',
    prefix:       null,
    photo_status: 'complete',
    has_equip_photo:     false,
    has_iso_photo:       false,
    equip_photo_url:     null,
    iso_photo_url:       null,
    placard_url:         null,
    signed_placard_url:  null,
    notes:     null,
    notes_es:  null,
    internal_notes: null,
    spanish_reviewed: false,
    verified:         false,
    verified_date:    null,
    verified_by:      null,
    needs_equip_photo:   false,
    needs_iso_photo:     false,
    needs_verification:  false,
    decommissioned: false,
    annotations: [],
    iso_annotations: [],
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

// Counter tiles render "<value>\n<label>" in adjacent sibling divs. Helper
// yields the numeric text on the line above the given label.
function counterValue(label: string): string {
  const labelEl = screen.getByText(label)
  return labelEl.previousElementSibling?.textContent?.trim() ?? ''
}

function row(id: string): HTMLElement {
  // Rows carry role="checkbox" with aria-label "<id> <description>"
  return screen.getByRole('checkbox', { name: new RegExp(`^${id} `) })
}

const SAMPLE: Equipment[] = [
  makeEquipment({ equipment_id: 'EQ-001', department: 'Alpha' }),
  makeEquipment({ equipment_id: 'EQ-002', department: 'Alpha' }),
  makeEquipment({ equipment_id: 'EQ-003', department: 'Beta'  }),
  makeEquipment({ equipment_id: 'EQ-004', department: 'Beta', decommissioned: true }),
]

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Load states ─────────────────────────────────────────────────────────────
describe('DecommissionPage — load states', () => {
  it('renders a skeleton while fetch is pending', () => {
    const hanging: Record<string, unknown> = { then: () => new Promise(() => {}) }
    const order = vi.fn().mockReturnValue(hanging)
    const selectFetch = vi.fn().mockReturnValue({ order })
    vi.mocked(supabase.from).mockReturnValue({ select: selectFetch } as unknown as ReturnType<typeof supabase.from>)

    render(<DecommissionPage />)
    // DecommissionSkeleton renders pulsing slate blocks (animate-pulse), not
    // a spinner — the shimmer signals structure-first loading.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('shows error UI and a working Retry button on fetch failure', async () => {
    installSupabase({ fetchError: { message: 'boom' } })
    render(<DecommissionPage />)
    await waitFor(() => screen.getByText('Could not load equipment'))
    expect(screen.getByText('Retry')).toBeInTheDocument()

    // Retry re-invokes fetch; swap to a successful response and click it.
    installSupabase({ fetchRows: SAMPLE })
    await userEvent.click(screen.getByText('Retry'))
    await waitFor(() => screen.getByText('EQ-001'))
  })
})

// ─── Rendering ───────────────────────────────────────────────────────────────
describe('DecommissionPage — rendering', () => {
  it('renders counters, all rows grouped by department, and the decomm subcount', async () => {
    installSupabase({ fetchRows: SAMPLE })
    render(<DecommissionPage />)

    await screen.findByText('EQ-001')

    // 3 active + 1 decommissioned = 4 total
    expect(counterValue('Active')).toBe('3')
    expect(counterValue('Decommissioned')).toBe('1')
    expect(counterValue('Total')).toBe('4')

    // Department headers + per-group subcounts. The page stores the
    // dept name in original case ("Alpha") and visually uppercases it
    // via Tailwind — so textContent stays mixed-case. Match with a
    // case-insensitive anchor so the assertion doesn't break the next
    // time the rendering flips between CSS-uppercase and JS-uppercase.
    expect(screen.getByText(/^alpha$/i)).toBeInTheDocument()
    expect(screen.getByText(/^beta$/i)).toBeInTheDocument()
    expect(screen.getByText('0/2 decommissioned')).toBeInTheDocument()
    expect(screen.getByText('1/2 decommissioned')).toBeInTheDocument()
  })

  it('shows "no equipment to show" when the DB returns an empty array', async () => {
    installSupabase({ fetchRows: [] })
    render(<DecommissionPage />)
    await waitFor(() => screen.getByText(/No equipment to show/i))
  })

  it('shows a search-specific empty state when no rows match', async () => {
    installSupabase({ fetchRows: SAMPLE })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    fireEvent.change(screen.getByPlaceholderText('Search equipment'), { target: { value: 'zzz' } })
    await waitFor(() => screen.getByText(/No equipment matches "zzz"/))
  })

  it('filters rows by id, description, and department (case-insensitive)', async () => {
    installSupabase({ fetchRows: SAMPLE })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    // Filter by id — only EQ-001 remains
    fireEvent.change(screen.getByPlaceholderText('Search equipment'), { target: { value: 'EQ-001' } })
    await waitFor(() => expect(screen.queryByText('EQ-002')).not.toBeInTheDocument())
    expect(screen.getByText('EQ-001')).toBeInTheDocument()

    // Filter by department (lowercase) — only Beta dept remains
    fireEvent.change(screen.getByPlaceholderText('Search equipment'), { target: { value: 'beta' } })
    await waitFor(() => expect(screen.queryByText('EQ-001')).not.toBeInTheDocument())
    expect(screen.getByText('EQ-003')).toBeInTheDocument()
    expect(screen.getByText('EQ-004')).toBeInTheDocument()
  })
})

// ─── Individual toggle ───────────────────────────────────────────────────────
describe('DecommissionPage — individual toggle', () => {
  it('optimistically flips a row, PATCHes with .select(), and shows a success toast', async () => {
    const m = installSupabase({
      fetchRows: SAMPLE,
      // The page now selects BOTH equipment_id AND decommissioned so it
      // can verify the stored value matches what we asked for. Mock
      // mirrors that contract: echo back decommissioned=true since
      // the test exercises an off→on toggle.
      updateResponses: [{ data: [{ equipment_id: 'EQ-001', decommissioned: true }], error: null }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await userEvent.click(row('EQ-001'))

    // PATCH fired with correct args — including the .select() that
    // distinguishes real writes from silent zero-row "successes" AND
    // verifies the persisted decommissioned value matches what we wrote.
    expect(m.update).toHaveBeenCalledWith({ decommissioned: true })
    expect(m.eq).toHaveBeenCalledWith('equipment_id', 'EQ-001')
    expect(m.updateSelect).toHaveBeenCalledWith('equipment_id, decommissioned')

    // Counters flipped (3/1 → 2/2) and success toast visible
    await waitFor(() => expect(counterValue('Active')).toBe('2'))
    expect(counterValue('Decommissioned')).toBe('2')
    expect(screen.getByRole('status')).toHaveTextContent(/EQ-001 decommissioned/i)
  })

  it('rolls back and toasts the server error on an explicit PATCH failure', async () => {
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [{ data: null, error: { message: 'RLS denied' } }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await userEvent.click(row('EQ-001'))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/RLS denied/))
    // Counters rolled back to original
    expect(counterValue('Active')).toBe('3')
    expect(counterValue('Decommissioned')).toBe('1')
  })

  it('rolls back when PATCH returns zero rows (silent RLS / session failure)', async () => {
    installSupabase({
      fetchRows: SAMPLE,
      // The bug the user hit: no error, but no rows written either.
      updateResponses: [{ data: [], error: null }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await userEvent.click(row('EQ-001'))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/0 rows affected/i),
    )
    expect(counterValue('Active')).toBe('3')
  })

  it('undo flips the row back when clicked', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [
        { data: [{ equipment_id: 'EQ-001', decommissioned: true  }], error: null }, // initial toggle
        { data: [{ equipment_id: 'EQ-001', decommissioned: false }], error: null }, // undo flips back
      ],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(row('EQ-001'))
    await waitFor(() => expect(counterValue('Decommissioned')).toBe('2'))

    await user.click(screen.getByRole('button', { name: /^undo$/i }))
    await waitFor(() => expect(counterValue('Decommissioned')).toBe('1'))
  })

  it('surfaces an error toast when an undo write fails silently', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [
        { data: [{ equipment_id: 'EQ-001', decommissioned: true }], error: null }, // first toggle succeeds
        { data: [], error: null },                                                  // undo silently rejected
      ],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(row('EQ-001'))
    await user.click(await screen.findByRole('button', { name: /^undo$/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Undo failed.*0 rows affected/i),
    )
  })

  it('does not fire a second PATCH while one is already pending for the same row', async () => {
    // Build a response that never resolves so the first PATCH stays in flight.
    const neverEnd: Record<string, unknown> = { then: () => new Promise(() => {}) }
    const updateSelect = vi.fn().mockReturnValue(neverEnd)
    const eq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq })

    // Fetch still resolves with SAMPLE
    const fetchEnd: Record<string, unknown> = {
      then: (r?: (v: unknown) => unknown) =>
        Promise.resolve({ data: SAMPLE, error: null }).then(r),
    }
    const selectFetch = vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue(fetchEnd) })
    vi.mocked(supabase.from).mockReturnValue({ select: selectFetch, update } as unknown as ReturnType<typeof supabase.from>)

    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await userEvent.click(row('EQ-001'))
    // Spinner confirms pending state, and a second click must be a no-op
    await waitFor(() => expect(within(row('EQ-001')).getByLabelText('Saving')).toBeInTheDocument())
    await userEvent.click(row('EQ-001'))
    expect(update).toHaveBeenCalledTimes(1)
  })
})

// ─── Keyboard navigation ─────────────────────────────────────────────────────
describe('DecommissionPage — keyboard', () => {
  it('Space toggles the focused row', async () => {
    const m = installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [{ data: [{ equipment_id: 'EQ-001', decommissioned: true }], error: null }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    const r = row('EQ-001')
    r.focus()
    fireEvent.keyDown(r, { key: ' ' })

    await waitFor(() => expect(m.update).toHaveBeenCalledWith({ decommissioned: true }))
  })

  it('ArrowDown/ArrowUp move focus and clamp at the edges', async () => {
    installSupabase({ fetchRows: SAMPLE })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    const r1 = row('EQ-001')
    r1.focus()
    fireEvent.keyDown(r1, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(row('EQ-002'))

    // Clamp at top
    fireEvent.keyDown(row('EQ-002'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(row('EQ-001'))
    fireEvent.keyDown(row('EQ-001'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(row('EQ-001'))

    // Clamp at bottom
    const last = row('EQ-004')
    last.focus()
    fireEvent.keyDown(last, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(last)
  })
})

// ─── Bulk selection + bar ────────────────────────────────────────────────────
describe('DecommissionPage — bulk selection', () => {
  it('selecting rows opens the bulk bar with the live count and clears via Clear', async () => {
    const user = userEvent.setup()
    installSupabase({ fetchRows: SAMPLE })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    const cbs = screen.getAllByLabelText(/^Select EQ-/)
    await user.click(cbs[0])
    await user.click(cbs[1])

    const bar = screen.getByRole('toolbar', { name: /bulk actions/i })
    expect(within(bar).getByText('2 selected')).toBeInTheDocument()

    await user.click(within(bar).getByLabelText('Clear selection'))
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument()
  })

  it('bulk decommission updates all selected rows and clears the selection', async () => {
    const user = userEvent.setup()
    const m = installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [{
        // Both rows reconcile as "saved" only when the returned
        // decommissioned value matches the requested next.
        data:  [
          { equipment_id: 'EQ-001', decommissioned: true },
          { equipment_id: 'EQ-002', decommissioned: true },
        ],
        error: null,
      }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByLabelText('Select EQ-002'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))

    expect(m.update).toHaveBeenCalledWith({ decommissioned: true })
    expect(m.in).toHaveBeenCalledWith('equipment_id', ['EQ-001', 'EQ-002'])

    await waitFor(() => expect(counterValue('Decommissioned')).toBe('3'))
    expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument()
  })

  it('bulk apply rolls back on error and keeps the selection', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [{ data: null, error: { message: 'perm denied' } }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Bulk update failed.*perm denied/i),
    )
    // State rolled back
    expect(counterValue('Decommissioned')).toBe('1')
    // Selection preserved for retry
    expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument()
  })

  it('bulk apply reconciles partial success to match what the server actually saved', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [{
        // Only EQ-001 was actually written (the page reconciles by
        // checking decommissioned === next on each returned row).
        data:  [{ equipment_id: 'EQ-001', decommissioned: true }],
        error: null,
      }],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByLabelText('Select EQ-002'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Saved 1 of 2.*1 rejected/i),
    )
    // EQ-001 kept (saved), EQ-002 reverted (rejected)
    expect(counterValue('Decommissioned')).toBe('2')
  })

  it('bulk apply disables the action buttons when effective selection is zero (all hidden by search)', async () => {
    const user = userEvent.setup()
    installSupabase({ fetchRows: SAMPLE })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    // Select two rows then filter them out by typing a search that matches neither
    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByLabelText('Select EQ-002'))
    fireEvent.change(screen.getByPlaceholderText('Search equipment'), { target: { value: 'EQ-003' } })

    // Bar still visible (selection retained), but the buttons are disabled
    // and the subtext calls out the hidden count.
    const bar = screen.getByRole('toolbar', { name: /bulk actions/i })
    expect(within(bar).getByText('0 selected')).toBeInTheDocument()
    expect(within(bar).getByText('(2 hidden by search)')).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /^decommission$/i })).toBeDisabled()
    expect(within(bar).getByRole('button', { name: /^restore$/i })).toBeDisabled()
  })

  it('individual toggle on a selected row is blocked while a bulk op is in flight', async () => {
    const user = userEvent.setup()
    // Bulk PATCH never resolves → bulkBusy stays true the whole test.
    const neverEnd: Record<string, unknown> = { then: () => new Promise(() => {}) }
    const updateSelect = vi.fn().mockReturnValue(neverEnd)
    const eq = vi.fn().mockReturnValue({ select: updateSelect })
    const inFn = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq, in: inFn })

    const fetchEnd: Record<string, unknown> = {
      then: (r?: (v: unknown) => unknown) =>
        Promise.resolve({ data: SAMPLE, error: null }).then(r),
    }
    const selectFetch = vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue(fetchEnd) })
    vi.mocked(supabase.from).mockReturnValue({ select: selectFetch, update } as unknown as ReturnType<typeof supabase.from>)

    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))

    // Bulk PATCH is in flight. Clicking EQ-001's body must NOT start a second PATCH.
    const callsBefore = update.mock.calls.length
    await user.click(row('EQ-001'))
    expect(update).toHaveBeenCalledTimes(callsBefore)
  })

  it('bulk apply undo reverts the change when clicked', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [
        { data: [{ equipment_id: 'EQ-001', decommissioned: true  }], error: null }, // initial bulk apply
        { data: [{ equipment_id: 'EQ-001', decommissioned: false }], error: null }, // undo flips back
      ],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))
    await waitFor(() => expect(counterValue('Decommissioned')).toBe('2'))

    await user.click(await screen.findByRole('button', { name: /^undo$/i }))
    await waitFor(() => expect(counterValue('Decommissioned')).toBe('1'))
  })

  it('bulk undo surfaces an error when the undo write is silently rejected', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [
        { data: [{ equipment_id: 'EQ-001', decommissioned: true }], error: null }, // bulk apply succeeds
        { data: [], error: null },                                                  // undo silently rejected
      ],
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))
    await user.click(await screen.findByRole('button', { name: /^undo$/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Undo failed\. Original change kept\./i),
    )
    // Reverted-to-optimistic state — EQ-001 stays decommissioned since the undo didn't land
    expect(counterValue('Decommissioned')).toBe('2')
  })

  it('bulk apply reports silent zero-row failure with a clear message', async () => {
    const user = userEvent.setup()
    installSupabase({
      fetchRows: SAMPLE,
      updateResponses: [{ data: [], error: null }], // silent no-op
    })
    render(<DecommissionPage />)
    await screen.findByText('EQ-001')

    await user.click(screen.getByLabelText('Select EQ-001'))
    await user.click(screen.getByRole('button', { name: /^decommission$/i }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Bulk update failed.*0 rows affected/i),
    )
    expect(counterValue('Decommissioned')).toBe('1')
  })
})
