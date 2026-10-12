import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PermitRow, RegistersHealth } from '@/lib/environmental/client'

// /environmental/permits (clause 6.1.3): permits grouped by program, each with
// a renewal countdown and a holder-of-record check; admins add permits, at a
// site; a slow response to an old filter never replaces the current one.

const access = vi.hoisted(() => ({ role: 'admin', facilityId: 'site-1' as string | null }))
const api = vi.hoisted(() => ({ listPermits: vi.fn(), getRegistersHealth: vi.fn(), createPermit: vi.fn() }))

vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenantId: 'tenant-1', role: access.role }) }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ profile: { is_superadmin: false } }) }))
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => ({ facilityId: access.facilityId }) }))
vi.mock('@/app/risk/_components/wizard/MemberPicker', () => ({ default: () => <span>member picker</span> }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import PermitsPage from '@/app/environmental/permits/page'

const permit = (over: Partial<PermitRow> = {}): PermitRow => ({
  id: 'p1', facility_id: 'site-1', program: 'wastewater', instrument: 'permit', title: 'Wastewater discharge permit',
  agency: 'City of Northfield', permit_number: 'DEMO-IWD-0001', jurisdiction: 'local:City of Northfield',
  holder_of_record: 'Northfield Forge & Finish LLC', issued_on: '2024-01-01', expires_on: '2027-01-01',
  renewal_application_due_on: '2026-10-31', renewal_submitted_on: null, business_critical: true, owner_user_id: null, notes: null,
  retired_at: null, retired_reason: null, last_reviewed_at: null, next_review_due: '2027-06-01',
  standing: 'renewal_due', renewal_deadline: '2026-10-31', escalation: { tier: 30, daysLeft: 29, nextTierOn: null },
  holder_mismatch: false, conditions_open: 2, conditions_overdue: 0, ...over,
})

const HEALTH: RegistersHealth['permits'] = {
  health: 'amber', active: 3, deadlineMissed: 0, holderMismatch: 1, renewalSoon: 1, conditionsOverdue: 1, reviewOverdue: 0,
}

const listing = (permits: PermitRow[]) => ({ permits, legalEntityInForce: 'Northfield Forge & Finish LLC', asOf: '2026-10-02' })

beforeEach(() => {
  access.role = 'admin'
  access.facilityId = 'site-1'
  for (const fn of Object.values(api)) fn.mockReset()
  api.getRegistersHealth.mockResolvedValue({ permits: HEALTH })
  api.listPermits.mockResolvedValue(listing([
    permit(),
    permit({ id: 'p2', program: 'stormwater', title: 'Stormwater coverage', holder_of_record: 'Northfield Metal Products Inc.',
      holder_mismatch: true, business_critical: false, standing: 'current', escalation: { tier: 'none', daysLeft: 400, nextTierOn: null },
      renewal_deadline: '2027-11-01', renewal_application_due_on: null, conditions_open: 1, conditions_overdue: 1 }),
  ]))
})

describe('/environmental/permits', () => {
  it('groups permits by program, each linking to its page', async () => {
    render(<PermitsPage />)
    const water = await screen.findByRole('region', { name: 'Wastewater' })
    expect(within(water).getByRole('link', { name: 'Wastewater discharge permit' })).toHaveAttribute('href', '/environmental/permits/p1')
    expect(within(screen.getByRole('region', { name: 'Stormwater' })).getByText('Stormwater coverage')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Air' })).not.toBeInTheDocument()
  })

  it('shows the countdown, the business-critical flag, the holder, and a red mismatch badge only where the holder differs', async () => {
    render(<PermitsPage />)
    const water = within(await screen.findByRole('region', { name: 'Wastewater' }))
    expect(water.getByText('Renewal application due 2026-10-31, in 29 days')).toBeInTheDocument()
    expect(water.getByText('Business-critical')).toBeInTheDocument()
    expect(water.queryByText('Holder mismatch')).not.toBeInTheDocument()
    const storm = within(screen.getByRole('region', { name: 'Stormwater' }))
    expect(storm.getByText('Holder mismatch')).toBeInTheDocument()
    expect(storm.getByText('Held by Northfield Metal Products Inc.')).toBeInTheDocument()
    expect(storm.getByText(/1 overdue/)).toBeInTheDocument()
  })

  it('shows the register health strip with what is wrong', async () => {
    render(<PermitsPage />)
    const strip = within(await screen.findByRole('region', { name: 'Permits register health' }))
    expect(await strip.findByText('Needs attention')).toBeInTheDocument()
    expect(strip.getByText('holder mismatch').parentElement).toHaveTextContent('1 holder mismatch')
    expect(strip.getByText('conditions overdue').parentElement).toHaveTextContent('1 conditions overdue')
  })

  it('asks the API for the filters chosen, and retired permits only when asked', async () => {
    render(<PermitsPage />)
    await screen.findByRole('region', { name: 'Wastewater' })
    expect(api.listPermits).toHaveBeenLastCalledWith('tenant-1', { status: 'active', program: undefined, standing: undefined, business_critical: undefined })
    fireEvent.change(screen.getByLabelText('Program'), { target: { value: 'air' } })
    fireEvent.click(screen.getByLabelText('Business-critical only'))
    fireEvent.click(screen.getByLabelText('Include retired'))
    await waitFor(() => expect(api.listPermits).toHaveBeenLastCalledWith('tenant-1',
      { status: 'all', program: 'air', standing: undefined, business_critical: true }))
  })

  it('shows only the answer to the current filter when an older one answers late', async () => {
    let answerFirst: (value: unknown) => void = () => {}
    api.listPermits
      .mockImplementationOnce(() => new Promise(resolve => { answerFirst = resolve }))
      .mockResolvedValueOnce(listing([permit({ id: 'p3', program: 'air', title: 'Air permit by rule' })]))
    render(<PermitsPage />)
    fireEvent.change(screen.getByLabelText('Program'), { target: { value: 'air' } })
    expect(await screen.findByText('Air permit by rule')).toBeInTheDocument()
    await act(async () => { answerFirst(listing([permit()])) })
    expect(screen.queryByText('Wastewater discharge permit')).not.toBeInTheDocument()
    expect(screen.getByText('Air permit by rule')).toBeInTheDocument()
  })

  it('says what an empty vault does and does not mean', async () => {
    api.listPermits.mockResolvedValue(listing([]))
    render(<PermitsPage />)
    expect(await screen.findByText(/No permits match/)).toBeInTheDocument()
  })

  it('shows the load error, and no list', async () => {
    api.listPermits.mockRejectedValue(new Error('Could not reach the server'))
    render(<PermitsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
  })

  it('lets an admin add a permit at a site, and not without one', async () => {
    const { unmount } = render(<PermitsPage />)
    await screen.findByRole('region', { name: 'Wastewater' })
    expect(screen.getByRole('button', { name: 'Add permit' })).toBeEnabled()
    unmount()

    access.facilityId = null
    render(<PermitsPage />)
    await screen.findByRole('region', { name: 'Wastewater' })
    expect(screen.getByRole('button', { name: 'Add permit' })).toBeDisabled()
    expect(screen.getByText(/Choose a facility in the header/)).toBeInTheDocument()
  })

  it('does not offer a member the add button', async () => {
    access.role = 'member'
    render(<PermitsPage />)
    await screen.findByRole('region', { name: 'Wastewater' })
    expect(screen.queryByRole('button', { name: 'Add permit' })).not.toBeInTheDocument()
  })

  it('opens the form with the legal entity in force as the holder, and refiles after saving', async () => {
    api.createPermit.mockResolvedValue({ permit: permit() })
    render(<PermitsPage />)
    await screen.findByRole('region', { name: 'Wastewater' })
    fireEvent.click(screen.getByRole('button', { name: 'Add permit' }))
    expect(screen.getByLabelText('Holder of record')).toHaveValue('Northfield Forge & Finish LLC')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Paint booth registration' } })
    fireEvent.change(screen.getByLabelText('Issuing agency'), { target: { value: 'State air agency' } })
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!)
    await waitFor(() => expect(api.createPermit).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      title: 'Paint booth registration', agency: 'State air agency', jurisdiction: 'federal',
      holder_of_record: 'Northfield Forge & Finish LLC', business_critical: false, owner_user_id: null,
    })))
  })
})
