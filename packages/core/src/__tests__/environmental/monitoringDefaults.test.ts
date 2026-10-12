import { describe, it, expect } from 'vitest'
import { DEFAULT_LIMITS, defaultLimitRow, defaultLimitsFor, reportingYearBasisFor } from '../../environmental/monitoringDefaults'
import { exceedanceSummary, validateMonitoringLimit, type MonitoringLimit } from '../../environmental/monitoring'

const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const permit = (key: string | null) => ({ stormwaterCoverage: 'general_permit' as const, stormwaterGeneralPermit: key })

const keys = (limits: ReturnType<typeof defaultLimitsFor>) => limits.map(l => l.libraryKey)

describe('the default catalog', () => {
  it('marks every row draft: a citation and a note on what to verify, on all of them', () => {
    expect(DEFAULT_LIMITS.length).toBeGreaterThan(0)
    for (const row of DEFAULT_LIMITS) {
      expect(row.citation.length, row.libraryKey).toBeGreaterThan(0)
      expect(row.verify.length, row.libraryKey).toBeGreaterThan(40)
    }
  })

  it('has unique keys that fit the library_key column', () => {
    const all = DEFAULT_LIMITS.map(l => l.libraryKey)
    expect(new Set(all).size).toBe(all.length)
    for (const key of all) expect(key, key).toMatch(/^[a-z0-9][a-z0-9._-]{0,79}$/)
  })

  it('is never a permit limit: a default is a benchmark or an action level a person must confirm, and only they can promote it', () => {
    for (const row of DEFAULT_LIMITS) expect(['benchmark', 'numeric_action_level'], row.libraryKey).toContain(row.basis)
  })

  it('fits what the limits table and the validator accept, for every row', () => {
    for (const row of DEFAULT_LIMITS) {
      const row_ = defaultLimitRow(row)
      const validated = validateMonitoringLimit({ facility_id: SITE, ...row_ })
      expect(validated.ok, `${row.libraryKey}: ${validated.ok ? '' : validated.errors.join(' ')}`).toBe(true)
      expect(String(row_.citation).length, row.libraryKey).toBeLessThanOrEqual(300)
      expect(String(row_.verify).length, row.libraryKey).toBeLessThanOrEqual(1000)
      expect(String(row_.parameter).length, row.libraryKey).toBeLessThanOrEqual(80)
    }
  })

  it('has no Texas row: no TPDES number is invented', () => {
    expect(DEFAULT_LIMITS.map(l => l.jurisdiction)).not.toContain('TX')
    expect(DEFAULT_LIMITS.map(l => l.libraryKey).filter(k => /tx|tpdes|txr/.test(k))).toEqual([])
  })

  describe('California Industrial General Permit', () => {
    const rows = DEFAULT_LIMITS.filter(l => l.generalPermit === 'ca_igp')
    const find = (parameter: string, kind: string) => rows.find(l => l.parameter === parameter && l.kind === kind)

    it('has the annual and instantaneous numeric action levels, as numeric action levels', () => {
      expect(find('TSS', 'annual_average')).toMatchObject({ value: 100, unit: 'mg/L', basis: 'numeric_action_level' })
      expect(find('Oil & grease', 'annual_average')).toMatchObject({ value: 15, unit: 'mg/L', basis: 'numeric_action_level' })
      expect(find('TSS', 'instantaneous_max')).toMatchObject({ value: 400, unit: 'mg/L', basis: 'numeric_action_level' })
      expect(find('Oil & grease', 'instantaneous_max')).toMatchObject({ value: 25, unit: 'mg/L', basis: 'numeric_action_level' })
    })

    it('has pH as a range: a minimum of 6.0 and a maximum of 9.0', () => {
      expect(find('pH', 'instantaneous_min')).toMatchObject({ value: 6, basis: 'numeric_action_level' })
      expect(find('pH', 'instantaneous_max')).toMatchObject({ value: 9, basis: 'numeric_action_level' })
    })

    it('asks the reviewer to confirm how an instantaneous exceedance is counted', () => {
      expect(find('TSS', 'instantaneous_max')?.verify).toMatch(/how the permit counts an instantaneous exceedance/)
    })
  })

  describe('EPA MSGP', () => {
    const rows = DEFAULT_LIMITS.filter(l => l.generalPermit === 'epa_msgp')

    it('has pH 6.0 to 9.0 and TSS 100 mg/L as benchmarks', () => {
      expect(rows.map(l => [l.parameter, l.kind, l.value, l.basis])).toEqual([
        ['pH', 'instantaneous_min', 6, 'benchmark'],
        ['pH', 'instantaneous_max', 9, 'benchmark'],
        ['TSS', 'annual_average', 100, 'benchmark'],
      ])
    })

    it('carries the lapse of the 2021 permit in every note, as the federal pack does', () => {
      for (const row of rows) expect(row.verify, row.libraryKey).toMatch(/2021 MSGP expired 2026-02-28/)
    })
  })
})

describe('defaultLimitsFor', () => {
  it('offers the IGP rows to a California site on the IGP, and not the MSGP rows', () => {
    const offered = defaultLimitsFor(['federal', 'CA'], permit('ca_igp'))
    expect(offered).toHaveLength(6)
    expect(offered.every(l => l.generalPermit === 'ca_igp' && l.jurisdiction === 'CA')).toBe(true)
  })

  it('offers the MSGP rows to a site on the MSGP, with only the federal layer', () => {
    expect(keys(defaultLimitsFor(['federal'], permit('epa_msgp')))).toEqual([
      'epa-msgp-benchmark-ph-min', 'epa-msgp-benchmark-ph-max', 'epa-msgp-benchmark-tss-annual',
    ])
  })

  it('offers nothing to a Texas site, on the TPDES permit or otherwise', () => {
    expect(defaultLimitsFor(['federal', 'TX'], permit('tx_txr05'))).toEqual([])
    expect(defaultLimitsFor(['federal', 'TX'], permit(null))).toEqual([])
  })

  it('offers nothing when the permit says CA but the site\'s rules do not reach California', () => {
    expect(defaultLimitsFor(['federal'], permit('ca_igp'))).toEqual([])
  })

  it('offers nothing to a site that is not on a general permit, or has not said which', () => {
    for (const stormwaterCoverage of ['not_evaluated', 'not_required', 'no_exposure', 'individual_permit'] as const) {
      expect(defaultLimitsFor(['federal', 'CA'], { stormwaterCoverage, stormwaterGeneralPermit: 'ca_igp' }), stormwaterCoverage).toEqual([])
    }
    expect(defaultLimitsFor(['federal', 'CA'], permit(null))).toEqual([])
    expect(defaultLimitsFor(['federal', 'CA'], permit('some_other_permit'))).toEqual([])
  })

  it('does not change the catalog it filters', () => {
    const before = DEFAULT_LIMITS.length
    defaultLimitsFor(['federal', 'CA'], permit('ca_igp')).pop()
    expect(DEFAULT_LIMITS).toHaveLength(before)
  })
})

describe('defaultLimitRow', () => {
  it('is a library row with its key, citation and verify note, and says nothing about where it applies', () => {
    const [first] = defaultLimitsFor(['federal', 'CA'], permit('ca_igp'))
    const row = defaultLimitRow(first!)
    expect(row).toMatchObject({ source: 'library', library_key: first!.libraryKey, citation: first!.citation, verify: first!.verify, basis: 'numeric_action_level' })
    expect(row).not.toHaveProperty('facility_id')
    expect(row).not.toHaveProperty('outfall_id')
  })
})

describe('reportingYearBasisFor', () => {
  it('starts the IGP year in July and every other year in January, each with a note to confirm', () => {
    expect(reportingYearBasisFor({ stormwaterGeneralPermit: 'ca_igp' })).toMatchObject({ startMonth: 7 })
    for (const key of ['epa_msgp', 'tx_txr05', null]) expect(reportingYearBasisFor({ stormwaterGeneralPermit: key })).toMatchObject({ startMonth: 1 })
    expect(reportingYearBasisFor({ stormwaterGeneralPermit: 'ca_igp' }).verify).toMatch(/Confirm/)
    expect(reportingYearBasisFor({ stormwaterGeneralPermit: null }).verify).toMatch(/Confirm/)
  })
})

describe('adopted defaults, judged', () => {
  const adopt = (key: string): MonitoringLimit => {
    const d = DEFAULT_LIMITS.find(l => l.libraryKey === key)!
    return {
      id: key, facilityId: SITE, outfallId: null, permitId: null, parameter: d.parameter, unit: d.unit, kind: d.kind, value: d.value,
      basis: d.basis, citation: d.citation, verify: d.verify, effectiveFrom: null, effectiveTo: null, source: 'library', libraryKey: key,
    }
  }
  const sample = (parameter: string, unit: string, value: number, id: string) => ({
    id, facilityId: SITE, outfallId: null, parameter, unit, value, belowDetection: false, sampledAt: '2026-02-03T10:00:00Z',
    eventLabel: null, lab: null, evidenceId: null, note: null, sampledBy: null,
  })

  it('counts a pH of 5.9 and a TSS of 450 as numeric action level exceedances, and not as permit limit exceedances', () => {
    const limits = ['ca-igp-nal-ph-instantaneous-min', 'ca-igp-nal-ph-instantaneous-max', 'ca-igp-nal-tss-instantaneous'].map(adopt)
    const summary = exceedanceSummary(limits, [sample('pH', 'su', 5.9, 'a'), sample('TSS', 'mg/L', 450, 'b'), sample('pH', 's.u.', 7, 'c')],
      Date.parse('2026-03-15T00:00:00Z'), { reportingYearStartMonth: 7 })
    expect(summary.totals).toEqual({ limit: 0, action: 2, internal: 0 })
  })
})
