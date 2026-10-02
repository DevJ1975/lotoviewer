import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PermitCondition, PermitRow } from '@/lib/environmental/client'

// One permit (clause 6.1.3): its renewal, its documents, its conditions and the
// changes that touched it. What a reader must not be misled about: a holder who
// is not the legal entity in force, an expired permit with a renewal pending
// (the agency, not this screen, says whether it is still in force), and who may
// record a condition as done.

const access = vi.hoisted(() => ({ role: 'admin', userId: 'u-admin' }))
const api = vi.hoisted(() => ({
  getPermit: vi.fn(), recordRenewalSubmitted: vi.fn(), recordRenewedTerm: vi.fn(), retirePermit: vi.fn(), reviewPermit: vi.fn(),
  addPermitCondition: vi.fn(), listOccurrences: vi.fn(), recordOccurrence: vi.fn(), updatePermit: vi.fn(),
  uploadEvidence: vi.fn(), downloadEvidence: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'p1' }) }))
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1', role: access.role }) }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ userId: access.userId, profile: { is_superadmin: false } }) }))
vi.mock('@/app/risk/_components/wizard/MemberPicker', () => ({
  default: () => <span>member picker</span>,
  memberName: (member: { full_name: string | null }) => member.full_name ?? 'Unnamed',
  useTenantMembers: () => ({ members: [{ user_id: 'u-owner', role: 'member', email: 'owner@example.test', full_name: 'Demo Condition Owner' }], error: null }),
}))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import PermitDetailPage from '@/app/environmental/permits/[id]/page'

const permit = (over: Partial<PermitRow> = {}): PermitRow => ({
  id: 'p1', facility_id: 'site-1', program: 'wastewater', instrument: 'permit', title: 'Wastewater discharge permit',
  agency: 'City of Northfield', permit_number: 'DEMO-IWD-0001', jurisdiction: 'local:City of Northfield',
  holder_of_record: 'Northfield Forge & Finish LLC', issued_on: '2024-01-01', expires_on: '2027-01-01',
  renewal_application_due_on: '2026-10-31', renewal_submitted_on: null, business_critical: true, owner_user_id: 'u-owner', notes: null,
  retired_at: null, retired_reason: null, last_reviewed_at: null, next_review_due: '2027-06-01',
  standing: 'renewal_due', renewal_deadline: '2026-10-31', escalation: { tier: 30, daysLeft: 29, nextTierOn: null },
  holder_mismatch: false, conditions_open: 1, conditions_overdue: 0, ...over,
})

const condition = (over: Partial<PermitCondition> = {}): PermitCondition => ({
  id: 'c1', title: 'Submit the quarterly monitoring report', description: null, cadence: 'quarterly', next_due_at: '2099-01-15',
  owner_user_id: 'u-owner', status: 'open', permit_id: 'p1', last_evaluated_at: null, last_result: null, ...over,
})

const detail = (over: Record<string, unknown> = {}) => ({
  permit: permit(), legalEntityInForce: 'Northfield Forge & Finish LLC', conditions: [condition()], documents: [], changes: [], ...over,
})

beforeEach(() => {
  access.role = 'admin'
  access.userId = 'u-admin'
  for (const fn of Object.values(api)) fn.mockReset()
  api.getPermit.mockResolvedValue(detail())
  api.listOccurrences.mockResolvedValue({ occurrences: [], evidence: [] })
})

describe('permit page', () => {
  it('shows the terms, the countdown and who owns it', async () => {
    render(<PermitDetailPage />)
    expect(await screen.findByRole('heading', { name: /Wastewater discharge permit/ })).toBeInTheDocument()
    expect(screen.getByText('Renewal application due 2026-10-31, in 29 days')).toBeInTheDocument()
    expect(screen.getByText('Demo Condition Owner')).toBeInTheDocument()
    expect(screen.getByText('2027-01-01')).toBeInTheDocument()
    expect(screen.getByText('Business-critical')).toBeInTheDocument()
  })

  it('explains a holder mismatch, naming both entities and the way to fix it', async () => {
    api.getPermit.mockResolvedValue(detail({ permit: permit({ holder_of_record: 'Northfield Metal Products Inc.', holder_mismatch: true }) }))
    render(<PermitDetailPage />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Northfield Metal Products Inc.')
    expect(alert).toHaveTextContent('Northfield Forge & Finish LLC')
    expect(alert).toHaveTextContent('change of owner or legal name')
  })

  it('does not guess whether an expired permit with a renewal pending is still in force', async () => {
    api.getPermit.mockResolvedValue(detail({
      permit: permit({ standing: 'expired_renewal_pending', renewal_submitted_on: '2026-09-01', expires_on: '2026-09-30' }),
    }))
    render(<PermitDetailPage />)
    expect(await screen.findByText(/confirm its status with the agency/)).toBeInTheDocument()
  })

  it('lists the changes that touched it, linking to each', async () => {
    api.getPermit.mockResolvedValue(detail({
      changes: [{ id: 'ch1', kind: 'ownership_name', title: 'Sale of the plant', status: 'open', opened_at: '2026-09-20T00:00:00Z', ended_at: null }],
    }))
    render(<PermitDetailPage />)
    expect(await screen.findByRole('link', { name: 'Sale of the plant' })).toHaveAttribute('href', '/environmental/changes/ch1')
  })

  it('shows a retired permit as history with no actions', async () => {
    api.getPermit.mockResolvedValue(detail({
      permit: permit({ retired_at: '2026-09-01T00:00:00Z', retired_reason: 'Surrendered', standing: 'retired', escalation: null }),
    }))
    render(<PermitDetailPage />)
    expect(await screen.findByText(/Retired 2026-09-01: Surrendered/)).toBeInTheDocument()
    for (const name of ['Edit', 'Retire', 'Mark reviewed', 'Add a condition']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Evidence file')).not.toBeInTheDocument()
  })

  it('gives a member the page to read, and no way to change it', async () => {
    access.role = 'member'
    render(<PermitDetailPage />)
    await screen.findByRole('heading', { name: /Wastewater discharge permit/ })
    for (const name of ['Edit', 'Retire', 'Mark reviewed', 'Add a condition', 'Record the renewed term']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Evidence file')).not.toBeInTheDocument()
  })

  it('shows the load error when the permit is not found', async () => {
    api.getPermit.mockRejectedValue(new Error('Not found'))
    render(<PermitDetailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found')
  })
})

describe('renewal', () => {
  it('records that the application was submitted, then reloads', async () => {
    api.recordRenewalSubmitted.mockResolvedValue({ permit: permit() })
    render(<PermitDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Record renewal application submitted' }))
    fireEvent.change(screen.getByLabelText('Date the renewal application was submitted'), { target: { value: '2026-10-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record submission' }))
    await waitFor(() => expect(api.recordRenewalSubmitted).toHaveBeenCalledWith('tenant-1', 'p1', '2026-10-02'))
    await waitFor(() => expect(api.getPermit).toHaveBeenCalledTimes(2))
  })

  it('says the countdown has stopped once submitted, and does not offer to submit again', async () => {
    api.getPermit.mockResolvedValue(detail({ permit: permit({ standing: 'renewal_submitted', renewal_submitted_on: '2026-10-01' }) }))
    render(<PermitDetailPage />)
    expect(await screen.findByText(/the countdown has stopped/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record renewal application submitted' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record the renewed term' })).toBeInTheDocument()
  })

  it('records a renewed term with the new dates, and shows a field the API refused', async () => {
    const { EmsApiError } = await import('@/lib/environmental/client')
    api.recordRenewedTerm.mockRejectedValue(new EmsApiError('Invalid', 400, [{ field: 'expiresOn', message: 'must be after the issue date' }]))
    render(<PermitDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Record the renewed term' }))
    fireEvent.change(screen.getByLabelText('Issued on'), { target: { value: '2027-01-01' } })
    fireEvent.change(screen.getByLabelText('Expires on (blank: no fixed term)'), { target: { value: '2026-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record renewed term' }))
    expect(await screen.findByText('must be after the issue date')).toBeInTheDocument()
    expect(api.recordRenewedTerm).toHaveBeenCalledWith('tenant-1', 'p1', {
      issued_on: '2027-01-01', expires_on: '2026-01-01', renewal_application_due_on: null, permit_number: 'DEMO-IWD-0001',
    })
  })
})

describe('retiring and reviewing', () => {
  it('needs a reason to retire, and says the record is kept', async () => {
    api.retirePermit.mockResolvedValue({ permit: permit() })
    render(<PermitDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retire' }))
    expect(screen.getByText(/kept as history/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retire permit' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why the permit is retired'), { target: { value: 'Process discontinued' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retire permit' }))
    await waitFor(() => expect(api.retirePermit).toHaveBeenCalledWith('tenant-1', 'p1', 'Process discontinued'))
  })

  it('marks the permit reviewed', async () => {
    api.reviewPermit.mockResolvedValue({ row: permit() })
    render(<PermitDetailPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }))
    await waitFor(() => expect(api.reviewPermit).toHaveBeenCalledWith('tenant-1', 'p1'))
  })
})

describe('conditions', () => {
  const section = async () => within(await screen.findByRole('region', { name: 'Conditions' }))

  it('lists each condition with its owner, cadence and due date, overdue ones in words', async () => {
    api.getPermit.mockResolvedValue(detail({
      conditions: [condition(), condition({ id: 'c2', title: 'Annual inspection', cadence: 'annual', next_due_at: '2020-01-01', owner_user_id: null })],
    }))
    render(<PermitDetailPage />)
    const conditions = await section()
    expect(conditions.getByText(/Quarterly · Demo Condition Owner/)).toBeInTheDocument()
    expect(conditions.getByText('Due 2099-01-15')).toBeInTheDocument()
    expect(conditions.getByText('Overdue since 2020-01-01')).toBeInTheDocument()
    expect(conditions.getByText(/No owner: admins are told/)).toBeInTheDocument()
  })

  it('records a condition done for the deadline shown, then offers the file for that occurrence', async () => {
    api.recordOccurrence.mockResolvedValue({ occurrence: { id: 'occ1', obligation_id: 'c1', occurrence_at: '2099-01-15' } })
    api.listOccurrences
      .mockResolvedValueOnce({ occurrences: [], evidence: [] })
      .mockResolvedValue({ occurrences: [{ id: 'occ1', obligation_id: 'c1', occurrence_at: '2099-01-15', completed_at: '2026-10-02T00:00:00Z', completed_by: 'u-admin', note: 'Filed online' }], evidence: [] })
    render(<PermitDetailPage />)
    const conditions = await section()
    fireEvent.click(conditions.getByRole('button', { name: 'Mark done, or see history' }))
    fireEvent.change(await conditions.findByLabelText(/Done for the 2099-01-15 deadline/), { target: { value: 'Filed online' } })
    fireEvent.click(conditions.getByRole('button', { name: 'Mark done' }))
    await waitFor(() => expect(api.recordOccurrence).toHaveBeenCalledWith('tenant-1', 'c1', '2099-01-15', 'Filed online'))
    expect(await conditions.findByText('Done for 2099-01-15')).toBeInTheDocument()
    expect(conditions.getAllByLabelText('Evidence file').length).toBeGreaterThan(0)
  })

  it('lets the condition\'s own owner mark it done, but not another member', async () => {
    access.role = 'member'
    access.userId = 'u-owner'
    const { unmount } = render(<PermitDetailPage />)
    fireEvent.click(await (await section()).findByRole('button', { name: 'Mark done, or see history' }))
    unmount()

    access.userId = 'u-someone-else'
    render(<PermitDetailPage />)
    const conditions = await section()
    fireEvent.click(await conditions.findByRole('button', { name: 'See history' }))
    await waitFor(() => expect(api.listOccurrences).toHaveBeenCalled())
    expect(conditions.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument()
  })

  it('shows what the database refused when marking done fails', async () => {
    api.recordOccurrence.mockRejectedValue(new Error('That deadline is no longer the next one due.'))
    render(<PermitDetailPage />)
    const conditions = await section()
    fireEvent.click(conditions.getByRole('button', { name: 'Mark done, or see history' }))
    fireEvent.click(await conditions.findByRole('button', { name: 'Mark done' }))
    expect(await conditions.findByRole('alert')).toHaveTextContent('no longer the next one due')
  })

  it('adds a condition to the permit', async () => {
    api.addPermitCondition.mockResolvedValue({ condition: condition() })
    render(<PermitDetailPage />)
    const conditions = await section()
    fireEvent.click(conditions.getByRole('button', { name: 'Add a condition' }))
    fireEvent.change(conditions.getByLabelText('Condition'), { target: { value: 'Calibrate the flow meter' } })
    fireEvent.change(conditions.getByLabelText('Next due'), { target: { value: '2027-02-01' } })
    fireEvent.click(conditions.getByRole('button', { name: 'Add condition' }))
    await waitFor(() => expect(api.addPermitCondition).toHaveBeenCalledWith('tenant-1', 'p1', {
      title: 'Calibrate the flow meter', next_due_at: '2027-02-01', cadence: 'annual', cadence_days: null, owner_user_id: null, description: null,
    }))
  })

  it('says what an empty list means', async () => {
    api.getPermit.mockResolvedValue(detail({ conditions: [] }))
    render(<PermitDetailPage />)
    expect(await screen.findByText(/No conditions recorded/)).toBeInTheDocument()
  })
})
