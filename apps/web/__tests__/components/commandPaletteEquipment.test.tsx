import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Regression guards for the palette's Equipment group.
//
// The group first shipped with `forceMount` on both the group and its items,
// reasoning that the rows were already filtered server-side so cmdk's
// client-side filter shouldn't second-guess them. forceMount does render the
// rows — but it renders them *outside* cmdk's filtered set, and two things
// read that set:
//
//   - <CommandEmpty> renders when the filtered count is 0. Typing an exact
//     equipment id matched no nav item, so the palette printed "No matches."
//     directly above the equipment row the user was looking at.
//   - cmdk only ever selects from the filtered set. The highlighted row could
//     not be one of the equipment rows, so pressing Enter activated an
//     unrelated nav item and navigated somewhere the user never chose.
//
// The fix is to stop force-mounting and instead give each row a `value`
// containing every column the server searched, so cmdk's own filter is
// provably no stricter than the query that produced the row.

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({ tenant: { id: 't1', modules: {} }, tenantId: 't1' }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ profile: { is_superadmin: false } }),
}))

const ROWS = [
  { equipment_id: 'PUMP-12', description: 'Feedwater pump', department: 'Boiler Room' },
]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({ limit: () => Promise.resolve({ data: ROWS }) }),
        }),
      }),
    }),
  },
}))

import CommandPalette from '@/components/CommandPalette'

// The lookup is debounced 300ms and userEvent.type resets that timer on every
// keystroke, so the query only fires ~300ms after the last character — then a
// promise and a re-render. waitFor's 1s default clears that on an idle machine
// but not inside the full suite, where these passed alone and failed in the
// pack. The wait is on a real debounce, so it gets a real budget.
const DEBOUNCED_QUERY_MS = 5000

async function search(text: string) {
  const user = userEvent.setup()
  render(<CommandPalette />)
  await user.keyboard('{Meta>}k{/Meta}')
  const input = await screen.findByPlaceholderText(/Search pages, modules, and equipment/i)
  await user.type(input, text)
  await waitFor(
    () => expect(screen.getByText('PUMP-12')).toBeInTheDocument(),
    { timeout: DEBOUNCED_QUERY_MS },
  )
  return user
}

describe('command palette — equipment results', () => {
  beforeEach(() => push.mockReset())

  it('does not claim "No matches." while an equipment row is on screen', async () => {
    await search('PUMP-12')
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument()
  })

  it('keeps a row matched on a field the user cannot see (department)', async () => {
    await search('Boiler')
    expect(screen.getByText('PUMP-12')).toBeInTheDocument()
    expect(screen.queryByText('No matches.')).not.toBeInTheDocument()
  })

  // The load-bearing part: an equipment row must be a real member of cmdk's
  // filtered set, not a force-mounted passenger, or it can never be selected.
  it('puts equipment rows in the selectable set', async () => {
    await search('PUMP-12')
    const values = Array.from(document.querySelectorAll('[cmdk-item]'))
      .map(el => el.getAttribute('data-value') ?? '')
    expect(values.some(v => v.includes('PUMP-12'))).toBe(true)
  })

  it('navigates to the equipment page when its row is chosen', async () => {
    const user = await search('PUMP-12')
    await user.click(screen.getByText('PUMP-12'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/equipment/PUMP-12'), { timeout: DEBOUNCED_QUERY_MS })
  })

  it('encodes an id that needs escaping', async () => {
    const original = ROWS[0]
    ROWS[0] = { equipment_id: 'LINE 3/A', description: 'Conveyor', department: 'Packing' }
    try {
      const user = userEvent.setup()
      render(<CommandPalette />)
      await user.keyboard('{Meta>}k{/Meta}')
      const input = await screen.findByPlaceholderText(/Search pages, modules, and equipment/i)
      await user.type(input, 'LINE')
      await waitFor(
        () => expect(screen.getByText('LINE 3/A')).toBeInTheDocument(),
        { timeout: DEBOUNCED_QUERY_MS },
      )
      await user.click(screen.getByText('LINE 3/A'))
      await waitFor(() => expect(push).toHaveBeenCalledWith('/equipment/LINE%203%2FA'), { timeout: DEBOUNCED_QUERY_MS })
    } finally {
      ROWS[0] = original
    }
  })
})
