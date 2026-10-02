import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ChangeRow, ChangeSummary, ImpactRow } from '@/lib/environmental/client'

// Management of change (clauses 6.1.4, 8.1). The list says how far along each
// change is; the form says what a change will create before it opens, and that
// a change of owner covers every site; the checklist groups impacts by the
// record they touch, says what would block each, and lets a change close only
// when every impact is resolved.

const access = vi.hoisted(() => ({ role: 'admin', facilityId: null as string | null }))
const nav = vi.hoisted(() => ({ push: vi.fn() }))
const api = vi.hoisted(() => ({
  listChanges: vi.fn(), getChange: vi.fn(), openChange: vi.fn(), previewChange: vi.fn(),
  closeChange: vi.fn(), cancelChange: vi.fn(), resolveImpact: vi.fn(), uploadEvidence: vi.fn(), downloadEvidence: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'ch1' }), useRouter: () => ({ push: nav.push }) }))
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1', role: access.role }) }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ profile: { is_superadmin: false } }) }))
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => ({ facilityId: access.facilityId }) }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import ChangesPage from '@/app/environmental/changes/page'
import ChangeDetailPage from '@/app/environmental/changes/[id]/page'

const change = (over: Partial<ChangeRow> = {}): ChangeRow => ({
  id: 'ch1', facility_id: null, discipline: 'ems', kind: 'ownership_name', title: 'Sale of the plant', description: 'The plant is sold.',
  process_area: null, new_legal_entity: 'Northfield Forge & Finish Holdings LLC', effective_on: '2026-12-01', status: 'open',
  requested_by: 'u1', opened_at: '2026-10-01T00:00:00Z', ended_at: null, ended_by: null, cancelled_reason: null, ...over,
})
const summary = (over: Partial<ChangeSummary> = {}): ChangeSummary => ({ ...change(), impacts_total: 11, impacts_resolved: 4, ...over })

const impact = (over: Partial<ImpactRow> = {}): ImpactRow => ({
  id: 'i1', change_id: 'ch1', target_type: 'permit', target_id: 'p1', step: 'notify_agency', step_order: 1,
  action_required: 'Tell the agency the owner is changing.', resolved_at: null, resolved_by: null, resolution_note: null,
  target_label: 'Wastewater discharge permit', target_href: '/environmental/permits/p1', needs_note: false, blockers: [], ...over,
})

beforeEach(() => {
  access.role = 'admin'
  access.facilityId = null
  for (const fn of [...Object.values(api), nav.push]) fn.mockReset()
})

describe('/environmental/changes', () => {
  beforeEach(() => api.listChanges.mockResolvedValue({ changes: [summary(), summary({ id: 'ch2', title: 'New paint line', kind: 'equipment', impacts_total: 0, impacts_resolved: 0 })] }))

  it('lists open changes with their progress, each linking to its checklist', async () => {
    render(<ChangesPage />)
    expect(await screen.findByRole('link', { name: 'Sale of the plant' })).toHaveAttribute('href', '/environmental/changes/ch1')
    expect(api.listChanges).toHaveBeenCalledWith('tenant-1', 'open')
    expect(screen.getByText('4 of 11 resolved')).toBeInTheDocument()
    // Nothing listed is not "complete": the row says nothing was checked automatically.
    expect(screen.getByText('No records listed automatically')).toBeInTheDocument()
    expect(screen.queryByText('0 of 0 resolved')).not.toBeInTheDocument()
    expect(screen.getByText(/Change of owner or legal name · opened 2026-10-01/)).toBeInTheDocument()
  })

  it('reloads for the status chosen', async () => {
    render(<ChangesPage />)
    await screen.findByText('Sale of the plant')
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'closed' } })
    await waitFor(() => expect(api.listChanges).toHaveBeenLastCalledWith('tenant-1', 'closed'))
  })

  it('says so when there are none', async () => {
    api.listChanges.mockResolvedValue({ changes: [] })
    render(<ChangesPage />)
    expect(await screen.findByText('No changes open.')).toBeInTheDocument()
  })

  it('gives only admins the New change button', async () => {
    access.role = 'member'
    render(<ChangesPage />)
    await screen.findByText('Sale of the plant')
    expect(screen.queryByRole('button', { name: 'New change' })).not.toBeInTheDocument()
  })

  it('previews what a change will create before opening it, and opens it onto its checklist', async () => {
    api.previewChange.mockResolvedValue({ preview: { impacts: 11, byTarget: { permit: 9, scope: 1, policy: 1 } } })
    api.openChange.mockResolvedValue({ change: change({ id: 'ch9' }), impacts: 11 })
    render(<ChangesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New change' }))
    fireEvent.change(screen.getByLabelText('What kind of change'), { target: { value: 'ownership_name' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sale of the plant' } })
    fireEvent.change(screen.getByLabelText('What is changing, and why'), { target: { value: 'The plant is sold.' } })
    fireEvent.change(screen.getByLabelText('New legal entity'), { target: { value: 'Northfield Forge & Finish Holdings LLC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview impacts' }))
    expect(await screen.findByRole('status')).toHaveTextContent('This will create 11 impacts to resolve: 9 permit steps, 1 scope, 1 policy.')
    expect(api.openChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open change' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/environmental/changes/ch9'))
    expect(api.openChange).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      kind: 'ownership_name', new_legal_entity: 'Northfield Forge & Finish Holdings LLC', process_area: null,
    }))
  })

  it('drops the preview as soon as the form changes, since it described other values', async () => {
    api.previewChange.mockResolvedValue({ preview: { impacts: 0, byTarget: {} } })
    render(<ChangesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview impacts' }))
    expect(await screen.findByRole('status')).toHaveTextContent('opens with an empty checklist')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('warns when a named process area matches no aspect, since that looks like a change that touches nothing', async () => {
    api.previewChange.mockResolvedValue({ preview: { impacts: 0, byTarget: {} } })
    render(<ChangesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New change' }))
    fireEvent.change(screen.getByLabelText(/Process area it happens in/), { target: { value: 'Paint Booth 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview impacts' }))
    expect(await screen.findByRole('status')).toHaveTextContent('No aspect is recorded in "Paint Booth 2"')
  })

  it('will not open a change of owner from a single site, and says to switch to all facilities', async () => {
    access.facilityId = 'site-1'
    render(<ChangesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New change' }))
    fireEvent.change(screen.getByLabelText('What kind of change'), { target: { value: 'ownership_name' } })
    expect(screen.getByText(/covers every site/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open change' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('What kind of change'), { target: { value: 'equipment' } })
    expect(screen.getByRole('button', { name: 'Open change' })).toBeEnabled()
  })

  it('shows the API\'s field errors beside the fields', async () => {
    const { EmsApiError } = await import('@/lib/environmental/client')
    api.openChange.mockRejectedValue(new EmsApiError('Invalid', 400, [{ field: 'title', message: 'is required' }]))
    render(<ChangesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open change' }))
    expect(await screen.findByText('is required')).toBeInTheDocument()
  })
})

describe('/environmental/changes/[id]', () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    change: change(),
    impacts: [
      impact(),
      impact({ id: 'i2', step: 'submit_transfer', step_order: 2, action_required: 'Submit the transfer.', blockers: ['Attach the file that shows it was submitted.'] }),
      impact({ id: 'i3', target_type: 'scope', target_id: 's1', step: null, step_order: 1, target_label: 'EMS scope', target_href: '/environmental/context',
        action_required: 'Update the scope to name the new owner.', needs_note: true }),
    ],
    evidence: [], closeBlockers: ['2 impacts are still unresolved.'], ...over,
  })

  beforeEach(() => api.getChange.mockResolvedValue(detail()))

  it('groups impacts by the record they touch, steps in order, with a link to each record', async () => {
    render(<ChangeDetailPage />)
    const permit = within(await screen.findByRole('region', { name: 'Wastewater discharge permit' }))
    expect(permit.getByRole('link', { name: 'Wastewater discharge permit' })).toHaveAttribute('href', '/environmental/permits/p1')
    expect(permit.getByText('Notify the agency')).toBeInTheDocument()
    expect(permit.getByText('Submit the transfer or update')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'EMS scope' })).getByText(/Update the scope to name the new owner/)).toBeInTheDocument()
    expect(screen.getByText('0 of 3 resolved')).toBeInTheDocument()
  })

  it('says why a step cannot be resolved yet, and holds the button until it can', async () => {
    render(<ChangeDetailPage />)
    const permit = within(await screen.findByRole('region', { name: 'Wastewater discharge permit' }))
    expect(permit.getByText('Attach the file that shows it was submitted.')).toBeInTheDocument()
    const [resolveFirst, resolveSecond] = permit.getAllByRole('button', { name: 'Resolve' })
    expect(resolveFirst).toBeEnabled()
    expect(resolveSecond).toBeDisabled()
  })

  it('needs a note where the rule asks for one', async () => {
    render(<ChangeDetailPage />)
    const scope = within(await screen.findByRole('region', { name: 'EMS scope' }))
    expect(scope.getByText('Note (required)')).toBeInTheDocument()
    expect(scope.getByRole('button', { name: 'Resolve' })).toBeDisabled()
    fireEvent.change(scope.getByLabelText('Note (required)'), { target: { value: 'Scope v4 names the new owner' } })
    expect(scope.getByRole('button', { name: 'Resolve' })).toBeEnabled()
  })

  it('resolves an impact with its note and reloads the checklist', async () => {
    api.resolveImpact.mockResolvedValue({ impact: impact() })
    render(<ChangeDetailPage />)
    const permit = within(await screen.findByRole('region', { name: 'Wastewater discharge permit' }))
    fireEvent.click(permit.getAllByRole('button', { name: 'Resolve' })[0])
    await waitFor(() => expect(api.resolveImpact).toHaveBeenCalledWith('tenant-1', 'ch1', 'i1', null))
    await waitFor(() => expect(api.getChange).toHaveBeenCalledTimes(2))
  })

  it('shows the database\'s reason when it refuses, in its own words', async () => {
    api.resolveImpact.mockRejectedValue(new Error('The permit\'s holder of record has not been updated to the new legal entity.'))
    render(<ChangeDetailPage />)
    const permit = within(await screen.findByRole('region', { name: 'Wastewater discharge permit' }))
    fireEvent.click(permit.getAllByRole('button', { name: 'Resolve' })[0])
    expect(await permit.findByRole('alert')).toHaveTextContent('holder of record has not been updated')
  })

  it('shows a resolved impact with its note and no further actions, and counts it', async () => {
    api.getChange.mockResolvedValue(detail({
      impacts: [impact({ resolved_at: '2026-10-02T00:00:00Z', resolution_note: 'Called and confirmed by email' })],
      closeBlockers: [],
    }))
    render(<ChangeDetailPage />)
    const permit = within(await screen.findByRole('region', { name: 'Wastewater discharge permit' }))
    expect(permit.getByText(/Resolved 2026-10-02: Called and confirmed by email/)).toBeInTheDocument()
    expect(permit.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
    expect(screen.getByText('1 of 1 resolved')).toBeInTheDocument()
  })

  it('holds Close until every impact is resolved, and says what is left', async () => {
    render(<ChangeDetailPage />)
    expect(await screen.findByText('2 impacts are still unresolved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close change' })).toBeDisabled()
  })

  it('closes a fully resolved change', async () => {
    api.getChange.mockResolvedValue(detail({ impacts: [impact({ resolved_at: '2026-10-02T00:00:00Z' })], closeBlockers: [] }))
    api.closeChange.mockResolvedValue({ change: change({ status: 'closed' }) })
    render(<ChangeDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Close change' }))
    await waitFor(() => expect(api.closeChange).toHaveBeenCalledWith('tenant-1', 'ch1'))
  })

  it('cancels with a reason, which it requires', async () => {
    api.cancelChange.mockResolvedValue({ change: change({ status: 'cancelled' }) })
    render(<ChangeDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel change' }))
    // The prompt's confirm button is the second "Cancel change" on the page.
    const confirm = screen.getAllByRole('button', { name: 'Cancel change' }).at(-1)!
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why the change is cancelled'), { target: { value: 'The sale fell through' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(api.cancelChange).toHaveBeenCalledWith('tenant-1', 'ch1', 'The sale fell through'))
  })

  it('offers an ended change no actions, and says how it ended', async () => {
    api.getChange.mockResolvedValue(detail({
      change: change({ status: 'cancelled', ended_at: '2026-10-05T00:00:00Z', cancelled_reason: 'The sale fell through' }), closeBlockers: [],
    }))
    render(<ChangeDetailPage />)
    expect(await screen.findByText(/Cancelled: The sale fell through/)).toBeInTheDocument()
    for (const name of ['Resolve', 'Close change', 'Cancel change']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('lets a member read the checklist and act on none of it', async () => {
    access.role = 'member'
    render(<ChangeDetailPage />)
    await screen.findByRole('region', { name: 'Wastewater discharge permit' })
    for (const name of ['Resolve', 'Close change', 'Cancel change']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Evidence file')).not.toBeInTheDocument()
  })

  it('says what an empty checklist means', async () => {
    api.getChange.mockResolvedValue(detail({ impacts: [], closeBlockers: [] }))
    render(<ChangeDetailPage />)
    expect(await screen.findByText(/touched no records automatically/)).toBeInTheDocument()
  })
})
