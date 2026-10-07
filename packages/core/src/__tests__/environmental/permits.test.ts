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

// ── validatePermit ──────────────────────────────────────────────────────────

import { validatePermit, decideRenewalAction, type PermitInput } from '../../environmental/permits'
import { planPermitRenewal as plan } from '../../environmental/permits'

const TENANT_PREFIX = '11111111-1111-1111-1111-111111111111/'
const FACILITY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const body = (over: Record<string, unknown> = {}) => ({
  facility_id: FACILITY, program: 'stormwater', permit_type: 'CA Industrial General Permit', permit_number: 'WDID 1 15I012345',
  status: 'active', effective_date: '2025-07-01', expiration_date: '2030-06-30', ...over,
})
const validate = (input: unknown, current?: PermitInput) => validatePermit(input, { documentPathPrefix: TENANT_PREFIX, current })

describe('validatePermit', () => {
  it('accepts a complete permit and applies the defaults', () => {
    const r = validate(body())
    expect(r).toMatchObject({ ok: true, permit: { facilityId: FACILITY, program: 'stormwater', status: 'active', renewalLeadDays: 180, conditions: [], identifiers: {} } })
  })

  it('needs a site, a program and a type', () => {
    const r = validate({})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.join(' ')).toMatch(/facility_id/)
      expect(r.errors.join(' ')).toMatch(/program/)
      expect(r.errors.join(' ')).toMatch(/permit_type/)
    }
  })

  it('rejects an expiration before the effective date, and dates that are not real', () => {
    expect(validate(body({ effective_date: '2026-01-01', expiration_date: '2025-01-01' })).ok).toBe(false)
    expect(validate(body({ expiration_date: '2026-02-30' })).ok).toBe(false)
    expect(validate(body({ expiration_date: 'soon' })).ok).toBe(false)
    expect(validate(body({ expiration_date: null })).ok).toBe(true)
  })

  it('bounds the renewal lead time to whole days from 0 to 1095', () => {
    for (const bad of [-1, 1096, 90.5, '90', null]) expect(validate(body({ renewal_lead_days: bad })).ok, String(bad)).toBe(false)
    expect(validate(body({ renewal_lead_days: 0 })).ok).toBe(true)
    expect(validate(body({ renewal_lead_days: 1095 })).ok).toBe(true)
  })

  it('takes jurisdiction as federal or a state code only', () => {
    expect(validate(body({ jurisdiction: 'CA' })).ok).toBe(true)
    expect(validate(body({ jurisdiction: 'federal' })).ok).toBe(true)
    expect(validate(body({ jurisdiction: 'California' })).ok).toBe(false)
  })

  it("refuses a document path outside the caller's folder, or one that climbs out of it", () => {
    expect(validate(body({ document_path: `${TENANT_PREFIX}permit.pdf` })).ok).toBe(true)
    for (const path of ['22222222-2222-2222-2222-222222222222/p.pdf', `${TENANT_PREFIX}../x.pdf`, 'p.pdf']) {
      expect(validate(body({ document_path: path })).ok, path).toBe(false)
    }
  })

  it('validates conditions and identifiers', () => {
    expect(validate(body({ conditions: [{ id: 'c1', text: 'Sample each quarter', frequency: 'quarterly' }], identifiers: { wdid: '1 15I012345' } })).ok).toBe(true)
    expect(validate(body({ conditions: [{ text: 'no id' }] })).ok).toBe(false)
    expect(validate(body({ conditions: 'x' })).ok).toBe(false)
    expect(validate(body({ identifiers: { n: 5 } })).ok).toBe(false)
  })

  it('keeps unmentioned fields on a partial update, and still validates what is sent', () => {
    const first = validate(body()) as { ok: true; permit: PermitInput }
    const patched = validate({ expiration_date: '2031-06-30' }, first.permit)
    expect(patched).toMatchObject({ ok: true, permit: { permitType: 'CA Industrial General Permit', expirationDate: '2031-06-30', facilityId: FACILITY } })
    expect(validate({ expiration_date: '2020-01-01' }, first.permit).ok).toBe(false)
  })
})

// ── decideRenewalAction ─────────────────────────────────────────────────────

const planned = (expirationDate = '2030-06-30') => plan({
  id: 'p1', facilityId: FACILITY, program: 'stormwater', permitType: 'CA IGP', permitNumber: '1', status: 'active', expirationDate, renewalLeadDays: 180,
})!

describe('decideRenewalAction', () => {
  it('creates the renewal deadline for a permit in force that has none yet', () => {
    expect(decideRenewalAction(planned(), null)).toMatchObject({ type: 'create' })
  })

  it('does nothing for a permit that implies no deadline and has none', () => {
    expect(decideRenewalAction(null, null)).toEqual({ type: 'none' })
  })

  it('moves an open deadline when the expiration date changes, and leaves it when nothing changed', () => {
    const p = planned()
    const existing = { id: 'ob', status: 'open' as const, nextDueAt: p.next_due_at, title: p.title }
    expect(decideRenewalAction(p, existing)).toEqual({ type: 'none' })
    expect(decideRenewalAction(planned('2031-06-30'), existing)).toMatchObject({ type: 'update', id: 'ob' })
  })

  it('dismisses an open deadline once the permit stops being in force, instead of leaving it to nag', () => {
    expect(decideRenewalAction(null, { id: 'ob', status: 'open', nextDueAt: '2030-01-01', title: 'x' })).toEqual({ type: 'dismiss', id: 'ob' })
  })

  it('never reopens or edits a deadline a person already completed or dismissed', () => {
    for (const status of ['completed', 'dismissed'] as const) {
      expect(decideRenewalAction(planned('2031-06-30'), { id: 'ob', status, nextDueAt: '2030-01-01', title: 'x' }), status).toEqual({ type: 'none' })
    }
  })
})

// ── row mapping ─────────────────────────────────────────────────────────────

import { toPermitRow, parsePermitRow } from '../../environmental/permits'

describe('permit row mapping', () => {
  it('round-trips a permit through its table columns', () => {
    const first = validate(body({ jurisdiction: 'CA', renewal_lead_days: 120, identifiers: { wdid: '1 15I012345' }, conditions: [{ id: 'c1', text: 'Sample quarterly' }], notes: 'n' })) as { ok: true; permit: PermitInput }
    expect(parsePermitRow(toPermitRow(first.permit))).toEqual(first.permit)
  })

  it('reads a sparse row without throwing, falling back to the default lead time', () => {
    const permit = parsePermitRow({ facility_id: FACILITY, program: 'air', permit_type: 'Title V', status: 'draft' })
    expect(permit).toMatchObject({ permitNumber: null, renewalLeadDays: 180, conditions: [], identifiers: {} })
  })
})
