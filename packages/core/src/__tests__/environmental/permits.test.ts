import { describe, it, expect } from 'vitest'
import { permitHealth, planPermitRenewal, DEFAULT_RENEWAL_LEAD_DAYS, type PermitForPlanning } from '../../environmental/permits'

const at = (iso: string) => new Date(`${iso}T09:00:00Z`)
const permit = (over: Partial<{ status: string; expirationDate: string | null; renewalLeadDays: number }> = {}) =>
  ({ status: 'active', expirationDate: '2027-04-30', renewalLeadDays: 180, ...over })

describe('permitHealth', () => {
  it('is active well before the renewal window', () => {
    expect(permitHealth(permit(), at('2026-10-07'))).toBe('active')
  })

  it('is expiring once inside the renewal lead time, including the day the window opens', () => {
    expect(permitHealth(permit(), at('2026-11-01'))).toBe('expiring')   // 180 days before 2027-04-30
    expect(permitHealth(permit(), at('2026-10-31'))).toBe('active')
    expect(permitHealth(permit(), at('2027-04-30'))).toBe('expiring')   // the expiration day itself
  })

  it('is expired the day after expiration', () => {
    expect(permitHealth(permit(), at('2027-05-01'))).toBe('expired')
  })

  it('trusts the date over a status field someone forgot to update', () => {
    expect(permitHealth(permit({ status: 'active', expirationDate: '2020-01-01' }), at('2026-10-07'))).toBe('expired')
    expect(permitHealth(permit({ status: 'expired', expirationDate: '2099-01-01' }), at('2026-10-07'))).toBe('expired')
  })

  it('does not track a permit that is not in force: a draft is not "fine"', () => {
    for (const status of ['draft', 'application_pending', 'terminated', 'not_required']) {
      expect(permitHealth(permit({ status, expirationDate: '2020-01-01' }), at('2026-10-07')), status).toBe('not_tracked')
    }
  })

  it('an active permit with no expiration date stays active rather than raising an alarm', () => {
    expect(permitHealth(permit({ expirationDate: null }), at('2026-10-07'))).toBe('active')
  })

  it('honours a different renewal lead time', () => {
    expect(permitHealth(permit({ renewalLeadDays: 30 }), at('2027-03-15'))).toBe('active')
    expect(permitHealth(permit({ renewalLeadDays: 30 }), at('2027-04-01'))).toBe('expiring')
    expect(DEFAULT_RENEWAL_LEAD_DAYS).toBe(180)
  })
})

const planning = (over: Partial<PermitForPlanning> = {}): PermitForPlanning => ({
  id: 'p1', facilityId: 'f1', program: 'air', permitType: 'SCAQMD Permit to Operate', permitNumber: 'F12345',
  status: 'active', expirationDate: '2026-12-06', renewalLeadDays: 60, ...over,
})

describe('planPermitRenewal', () => {
  it('plans a one-time renewal due the lead time before expiration', () => {
    expect(planPermitRenewal(planning())).toMatchObject({
      system_key: 'env:permit-renewal:p1:f1', title: 'Renew SCAQMD Permit to Operate F12345',
      next_due_at: '2026-10-07', cadence: 'once', program: 'air', category: 'environmental', facility_id: 'f1',
    })
  })

  it('names the permit by type alone when it has no number', () => {
    expect(planPermitRenewal(planning({ permitNumber: null }))!.title).toBe('Renew SCAQMD Permit to Operate')
  })

  it('plans nothing for a permit not in force or without an expiration date', () => {
    expect(planPermitRenewal(planning({ status: 'draft' }))).toBeNull()
    expect(planPermitRenewal(planning({ status: 'expired' }))).toBeNull()
    expect(planPermitRenewal(planning({ expirationDate: null }))).toBeNull()
  })

  it('returns a renewal date already past as is: a missed window is what the calendar should show overdue', () => {
    expect(planPermitRenewal(planning({ expirationDate: '2026-11-01', renewalLeadDays: 180 }))!.next_due_at).toBe('2026-05-05')
  })

  it('has a stable system key per permit so re-planning updates nothing twice', () => {
    expect(planPermitRenewal(planning())!.system_key).toBe(planPermitRenewal(planning({ renewalLeadDays: 90 }))!.system_key)
  })

  it('maps an "other" permit onto a program the calendar knows', () => {
    expect(planPermitRenewal(planning({ program: 'other' }))!.program).toBe('stormwater')
  })
})
