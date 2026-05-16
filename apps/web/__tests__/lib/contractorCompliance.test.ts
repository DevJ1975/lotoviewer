import { describe, it, expect } from 'vitest'
import {
  buildContractorInsuranceDigest,
  classifyInsurance,
  INSURANCE_EXPIRED_GRACE_DAYS,
  INSURANCE_EXPIRING_WINDOW_DAYS,
  type ContractorCompany,
} from '@soteria/core/contractorCompliance'

const ASOF = new Date('2026-05-15T00:00:00Z')

function company(p: Partial<ContractorCompany> & Pick<ContractorCompany, 'id' | 'name'>): ContractorCompany {
  return {
    tenant_id: 't-1',
    contact_email: null,
    contact_phone: null,
    insurance_expires_at: null,
    host_procedures_acknowledged_at: null,
    host_acknowledged_by_user_id: null,
    notes: null,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...p,
  }
}

describe('classifyInsurance', () => {
  it('returns missing when no expiry is on file', () => {
    expect(classifyInsurance(null, ASOF).status).toBe('missing')
  })

  it('returns expired for a past date', () => {
    const r = classifyInsurance('2026-04-01', ASOF)
    expect(r.status).toBe('expired')
    expect(r.days).toBe(44)
  })

  it('returns expiring within the 30-day warning window', () => {
    const r = classifyInsurance('2026-05-30', ASOF)
    expect(r.status).toBe('expiring')
    expect(r.days).toBe(15)
  })

  it('returns current outside the warning window', () => {
    const r = classifyInsurance('2026-08-01', ASOF)
    expect(r.status).toBe('current')
  })

  it('treats today as expiring (zero days remaining)', () => {
    const r = classifyInsurance('2026-05-15', ASOF)
    expect(r.status).toBe('expiring')
    expect(r.days).toBe(0)
  })

  it('returns missing on unparseable input (defensive)', () => {
    expect(classifyInsurance('not-a-date', ASOF).status).toBe('missing')
  })
})

describe('buildContractorInsuranceDigest', () => {
  it('drops inactive contractors entirely', () => {
    const rows = buildContractorInsuranceDigest([
      company({ id: 'c-1', name: 'Inactive Co', insurance_expires_at: '2026-04-01', active: false }),
    ], ASOF)
    expect(rows).toEqual([])
  })

  it('drops current contractors (digest is about renewal action)', () => {
    const rows = buildContractorInsuranceDigest([
      company({ id: 'c-1', name: 'Healthy Co', insurance_expires_at: '2027-01-01' }),
    ], ASOF)
    expect(rows).toEqual([])
  })

  it('drops contractors with no expiry on file (admin-data issue, not a digest entry)', () => {
    const rows = buildContractorInsuranceDigest([
      company({ id: 'c-1', name: 'No Date Co', insurance_expires_at: null }),
    ], ASOF)
    expect(rows).toEqual([])
  })

  it('includes expiring and expired contractors, expired-first then by urgency', () => {
    const rows = buildContractorInsuranceDigest([
      company({ id: 'c-near', name: 'Expiring Soon',  insurance_expires_at: '2026-05-20' }),  // 5 days
      company({ id: 'c-far',  name: 'Expiring Later', insurance_expires_at: '2026-06-10' }),  // 26 days
      company({ id: 'c-late', name: 'Expired Recently', insurance_expires_at: '2026-05-12' }), // 3 days ago
      company({ id: 'c-old',  name: 'Expired Long Ago', insurance_expires_at: '2025-01-01' }), // hundreds of days
    ], ASOF)

    expect(rows.map(r => r.contractor_id)).toEqual([
      'c-late',  // expired recently — within the grace window, surfaces
      'c-near',
      'c-far',
    ])
    // c-old was dropped (past the 7-day grace).
  })

  it('exact-day boundaries are inclusive — exactly 30 days = expiring; exactly the grace day = included', () => {
    const exactBoundary = new Date(ASOF.getTime() + INSURANCE_EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const exactGrace    = new Date(ASOF.getTime() - INSURANCE_EXPIRED_GRACE_DAYS  * 24 * 60 * 60 * 1000)
    const rows = buildContractorInsuranceDigest([
      company({ id: 'c-exp-30',    name: 'Day 30',    insurance_expires_at: exactBoundary.toISOString().slice(0, 10) }),
      company({ id: 'c-overdue-7', name: 'Overdue 7', insurance_expires_at: exactGrace.toISOString().slice(0, 10) }),
    ], ASOF)
    expect(rows.map(r => r.contractor_id).sort()).toEqual(['c-exp-30', 'c-overdue-7'])
  })
})
