import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  annualAverage, convertValue, evaluateAnnualAverage, evaluateResult, exceedanceSummary, FUTURE_ALLOWANCE_MS, judgeResult,
  limitInForce, limitsApplying, normalizeParameter, parseLimitRow, parseResultRow, reportingYearFor, toLimitRow, toResultRow,
  validateMonitoringLimit, validateMonitoringResult,
  type MonitoringLimit, type MonitoringResult,
} from '../../environmental/monitoring'

const SITE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OF1 = 'f0000000-0000-0000-0000-0000000000a1'
const OF2 = 'f0000000-0000-0000-0000-0000000000a2'
const TENANT = '11111111-1111-1111-1111-111111111111'

let counter = 0
const limit = (over: Partial<MonitoringLimit> = {}): MonitoringLimit => ({
  id: `limit-${++counter}`, facilityId: SITE, outfallId: null, permitId: null, parameter: 'TSS', unit: 'mg/L', kind: 'instantaneous_max',
  value: 100, basis: 'benchmark', citation: null, verify: null, effectiveFrom: null, effectiveTo: null, source: 'tenant', libraryKey: null, ...over,
})
const result = (over: Partial<MonitoringResult> = {}): MonitoringResult => ({
  id: `result-${++counter}`, facilityId: SITE, outfallId: OF1, parameter: 'TSS', unit: 'mg/L', value: 50, belowDetection: false,
  sampledAt: '2026-02-03T10:00:00Z', eventLabel: null, lab: null, evidenceId: null, note: null, sampledBy: null, ...over,
})

const NOW = Date.parse('2026-03-15T12:00:00Z')
const calendarYear = { reportingYearStartMonth: 1 }
const julyYear = { reportingYearStartMonth: 7 }

afterEach(() => vi.restoreAllMocks())

describe('normalizeParameter', () => {
  it('ignores case and spacing, so a typed "oil &  grease" finds the limit "Oil & grease"', () => {
    expect(normalizeParameter('  Oil &   Grease ')).toBe('oil & grease')
    expect(normalizeParameter('TSS')).toBe(normalizeParameter('tss'))
  })
})

describe('convertValue', () => {
  it('leaves a value alone in the same unit, however the unit is spelled', () => {
    expect(convertValue(12.5, 'mg/L', 'MG/L')).toBe(12.5)
    expect(convertValue(7.2, 's.u.', 'su')).toBe(7.2)
    expect(convertValue(7.2, 'standard units', 'pH')).toBe(7.2)
  })

  it('converts mg/L and ug/L both ways, with either micro sign', () => {
    expect(convertValue(1, 'mg/L', 'µg/L')).toBe(1000)
    expect(convertValue(1, 'mg/L', 'μg/L')).toBe(1000)
    expect(convertValue(250, 'ug/L', 'mg/L')).toBe(0.25)
  })

  it('reads ppm as mg/L and ppb as ug/L', () => {
    expect(convertValue(15, 'ppm', 'mg/L')).toBe(15)
    expect(convertValue(15, 'mg/L', 'ppm')).toBe(15)
    expect(convertValue(15, 'ppb', 'ug/L')).toBe(15)
    expect(convertValue(1, 'ppm', 'ppb')).toBe(1000)
  })

  it('does not let floating point turn an exact value into one just past it', () => {
    // 2.007 * 1000 is 2007.0000000000002 and 1.005 * 1000 is 1004.9999999999999 before tidying.
    expect(convertValue(2.007, 'mg/L', 'ug/L')).toBe(2007)
    expect(convertValue(1.005, 'mg/L', 'ug/L')).toBe(1005)
    expect(convertValue(4.03, 'mg/L', 'ug/L')).toBe(4030)
    expect(convertValue(1100, 'ug/L', 'mg/L')).toBe(1.1)
    expect(convertValue(0.3, 'mg/L', 'ug/L')).toBe(300)
  })

  it('refuses to guess between units it has no certain conversion for', () => {
    expect(convertValue(1, 'mg/L', 'NTU')).toBeNull()
    expect(convertValue(1, 'mg/L as N', 'mg/L')).toBeNull()
    expect(convertValue(1, 'MPN/100 mL', 'mg/L')).toBeNull()
    expect(convertValue(7, 's.u.', 'mg/L')).toBeNull()
  })
})

describe('evaluateResult: a maximum', () => {
  const max = limit({ value: 100 })

  it('is within below the limit, with the room left as the margin', () => {
    expect(evaluateResult(max, result({ value: 40 }))).toEqual({ status: 'within', margin: 60, reason: null })
  })

  it('is within exactly at the limit: equal is not an exceedance', () => {
    expect(evaluateResult(max, result({ value: 100 }))).toEqual({ status: 'within', margin: 0, reason: null })
  })

  it('exceeds just past the limit, with a negative margin', () => {
    expect(evaluateResult(max, result({ value: 100.5 }))).toEqual({ status: 'exceeds', margin: -0.5, reason: null })
  })

  it('does not report floating point noise as a margin, at any scale', () => {
    expect(evaluateResult(limit({ value: 0.3 }), result({ value: 0.1 })).margin).toBe(0.2)
    expect(evaluateResult(limit({ value: 1e-9 }), result({ value: 3e-10 })).margin).toBe(7e-10)
    expect(evaluateResult(limit({ value: 1e9 }), result({ value: 1e9 - 0.5 })).margin).toBe(0.5)
    expect(evaluateResult(limit({ value: 2007, unit: 'ug/L' }), result({ value: 2.0071, unit: 'mg/L' })).margin).toBe(-0.1)
  })

  it('reports exactly zero, never negative zero, at the limit', () => {
    expect(Object.is(evaluateResult(limit({ value: 0.3 }), result({ value: 0.1 + 0.2 })).margin, 0)).toBe(true)
    expect(evaluateResult(limit({ value: 0.3 }), result({ value: 0.1 + 0.2 })).status).toBe('within')
  })
})

describe('evaluateResult: a minimum', () => {
  const min = limit({ kind: 'instantaneous_min', parameter: 'pH', unit: 's.u.', value: 6 })
  const ph = (value: number) => result({ parameter: 'pH', unit: 's.u.', value })

  it('is within at and above the limit, and exceeds below it', () => {
    expect(evaluateResult(min, ph(6))).toEqual({ status: 'within', margin: 0, reason: null })
    expect(evaluateResult(min, ph(7.2))).toMatchObject({ status: 'within', margin: 1.2 })
    expect(evaluateResult(min, ph(5.99))).toEqual({ status: 'exceeds', margin: -0.01, reason: null })
  })
})

describe('evaluateResult: pH is a range of two limits, and both ends are within', () => {
  const range = [
    limit({ id: 'ph-min', parameter: 'pH', unit: 's.u.', kind: 'instantaneous_min', value: 6, basis: 'numeric_action_level' }),
    limit({ id: 'ph-max', parameter: 'pH', unit: 's.u.', kind: 'instantaneous_max', value: 9, basis: 'numeric_action_level' }),
  ]
  const verdicts = (value: number) => judgeResult(range, result({ parameter: 'pH', unit: 's.u.', value })).map(j => `${j.limit.id}:${j.evaluation.status}`)

  it('is within at 6.0 and at 9.0, and between', () => {
    expect(verdicts(6)).toEqual(['ph-min:within', 'ph-max:within'])
    expect(verdicts(9)).toEqual(['ph-min:within', 'ph-max:within'])
    expect(verdicts(7.4)).toEqual(['ph-min:within', 'ph-max:within'])
  })

  it('exceeds the minimum just under 6.0 and the maximum just over 9.0, and only that one', () => {
    expect(verdicts(5.99)).toEqual(['ph-min:exceeds', 'ph-max:within'])
    expect(verdicts(9.01)).toEqual(['ph-min:within', 'ph-max:exceeds'])
  })
})

describe('evaluateResult: units', () => {
  it('is not evaluable when the units cannot be compared, and says which', () => {
    const evaluation = evaluateResult(limit({ unit: 'mg/L' }), result({ unit: 'NTU' }))
    expect(evaluation).toMatchObject({ status: 'not_evaluable', margin: null })
    expect(evaluation.reason).toBe('Unit mismatch: the result is in NTU and the limit is in mg/L.')
  })

  it('converts a result in ug/L to the limit\'s mg/L, and judges the boundary exactly', () => {
    const max = limit({ value: 100, unit: 'mg/L' })
    expect(evaluateResult(max, result({ value: 100000, unit: 'ug/L' }))).toMatchObject({ status: 'within', margin: 0 })
    expect(evaluateResult(max, result({ value: 100001, unit: 'ug/L' }))).toMatchObject({ status: 'exceeds', margin: -0.001 })
  })

  it('judges a result in mg/L against a limit in ug/L at its boundary without noise', () => {
    expect(evaluateResult(limit({ value: 1100, unit: 'ug/L' }), result({ value: 1.1, unit: 'mg/L' }))).toMatchObject({ status: 'within', margin: 0 })
    // 2.007 mg/L is 2007.0000000000002 ug/L before tidying: just over a limit of 2007 that it equals.
    expect(evaluateResult(limit({ value: 2007, unit: 'ug/L' }), result({ value: 2.007, unit: 'mg/L' }))).toMatchObject({ status: 'within', margin: 0 })
    expect(evaluateResult(limit({ value: 2007, unit: 'ug/L' }), result({ value: 2.0071, unit: 'mg/L' }))).toMatchObject({ status: 'exceeds', margin: -0.1 })
  })
})

describe('evaluateResult: non-detects', () => {
  const nd = (value: number, over: Partial<MonitoringResult> = {}) => result({ belowDetection: true, value, ...over })

  it('is within when the reporting limit is under the limit: the lab could have seen a violation and did not', () => {
    const evaluation = evaluateResult(limit({ value: 100 }), nd(5))
    expect(evaluation).toMatchObject({ status: 'within', margin: 95 })
    expect(evaluation.reason).toMatch(/Not detected.*reporting limit \(5 mg\/L\)/)
  })

  it('is within when the reporting limit equals the limit', () => {
    expect(evaluateResult(limit({ value: 100 }), nd(100))).toMatchObject({ status: 'within', margin: 0 })
  })

  it('is not evaluable, and never an exceedance, when the reporting limit is above the limit', () => {
    const evaluation = evaluateResult(limit({ value: 15 }), nd(50))
    expect(evaluation.status).toBe('not_evaluable')
    expect(evaluation.margin).toBeNull()
    expect(evaluation.reason).toMatch(/could not show compliance/)
  })

  it('compares the reporting limit in the limit\'s unit', () => {
    expect(evaluateResult(limit({ value: 1, unit: 'mg/L' }), nd(500, { unit: 'ug/L' })).status).toBe('within')
    expect(evaluateResult(limit({ value: 1, unit: 'mg/L' }), nd(2000, { unit: 'ug/L' })).status).toBe('not_evaluable')
  })

  it('cannot show that a minimum was met', () => {
    expect(evaluateResult(limit({ kind: 'instantaneous_min', value: 6 }), nd(0.1)).status).toBe('not_evaluable')
  })
})

describe('evaluateResult: limits judged on more than one sample', () => {
  it('does not judge a daily maximum, a monthly average or an annual average one sample at a time', () => {
    for (const kind of ['daily_max', 'monthly_average', 'annual_average'] as const) {
      const evaluation = evaluateResult(limit({ kind }), result({ value: 9999 }))
      expect(evaluation.status, kind).toBe('not_evaluable')
      expect(evaluation.reason, kind).toMatch(/not judged one sample at a time/)
    }
  })
})

describe('limitInForce', () => {
  it('includes both end dates and treats a missing end as open', () => {
    const window = { effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }
    expect(limitInForce(window, '2025-12-31')).toBe(false)
    expect(limitInForce(window, '2026-01-01')).toBe(true)
    expect(limitInForce(window, '2026-06-30')).toBe(true)
    expect(limitInForce(window, '2026-07-01')).toBe(false)
    expect(limitInForce({ effectiveFrom: null, effectiveTo: null }, '1999-01-01')).toBe(true)
    expect(limitInForce({ effectiveFrom: '2026-01-01', effectiveTo: null }, '2090-01-01')).toBe(true)
    expect(limitInForce({ effectiveFrom: null, effectiveTo: '2026-01-01' }, '2026-01-02')).toBe(false)
  })
})

describe('limitsApplying', () => {
  const ids = (limits: MonitoringLimit[]) => limits.map(l => l.id)

  it('puts an outfall\'s own limit before a site-wide one, and leaves out another outfall\'s', () => {
    const siteWide = limit({ id: 'site', basis: 'benchmark' })
    const own = limit({ id: 'own', outfallId: OF1, basis: 'permit_limit' })
    const other = limit({ id: 'other', outfallId: OF2, basis: 'permit_limit' })
    expect(ids(limitsApplying([siteWide, other, own], result({ outfallId: OF1 })))).toEqual(['own', 'site'])
    expect(ids(limitsApplying([siteWide, other, own], result({ outfallId: OF2 })))).toEqual(['other', 'site'])
  })

  it('gives a site-level sample only the site-wide limits', () => {
    const siteWide = limit({ id: 'site' })
    const own = limit({ id: 'own', outfallId: OF1 })
    expect(ids(limitsApplying([own, siteWide], result({ outfallId: null })))).toEqual(['site'])
  })

  it('matches the parameter however it is spelled', () => {
    const og = limit({ id: 'og', parameter: 'Oil & grease' })
    expect(ids(limitsApplying([og], result({ parameter: ' oil &  GREASE ' })))).toEqual(['og'])
    expect(ids(limitsApplying([og], result({ parameter: 'TSS' })))).toEqual([])
  })

  it('applies a limit only on the days it is in force, both end dates included', () => {
    const dated = limit({ id: 'dated', effectiveFrom: '2026-02-03', effectiveTo: '2026-02-03' })
    expect(ids(limitsApplying([dated], result({ sampledAt: '2026-02-03T00:00:00Z' })))).toEqual(['dated'])
    expect(ids(limitsApplying([dated], result({ sampledAt: '2026-02-03T23:59:59Z' })))).toEqual(['dated'])
    expect(ids(limitsApplying([dated], result({ sampledAt: '2026-02-02T23:59:59Z' })))).toEqual([])
    expect(ids(limitsApplying([dated], result({ sampledAt: '2026-02-04T00:00:00Z' })))).toEqual([])
  })

  it('judges a sample against the limit in force when it was taken, not the one in force now', () => {
    const old = limit({ id: 'old', value: 150, effectiveTo: '2026-01-31' })
    const current = limit({ id: 'current', value: 100, effectiveFrom: '2026-02-01' })
    expect(ids(limitsApplying([old, current], result({ sampledAt: '2026-01-31T12:00:00Z' })))).toEqual(['old'])
    expect(ids(limitsApplying([old, current], result({ sampledAt: '2026-02-01T12:00:00Z' })))).toEqual(['current'])
  })

  it('lets an outfall\'s limit replace a site-wide limit of the same kind and basis, not one of another basis or kind', () => {
    const siteWide = [
      limit({ id: 'site-benchmark', basis: 'benchmark' }),
      limit({ id: 'site-permit', basis: 'permit_limit' }),
      limit({ id: 'site-daily', basis: 'benchmark', kind: 'daily_max' }),
    ]
    const exception = limit({ id: 'of1-benchmark', outfallId: OF1, basis: 'benchmark', value: 150 })
    expect(ids(limitsApplying([...siteWide, exception], result({ outfallId: OF1 })))).toEqual(['of1-benchmark', 'site-permit', 'site-daily'])
    expect(ids(limitsApplying([...siteWide, exception], result({ outfallId: OF2 })))).toEqual(['site-benchmark', 'site-permit', 'site-daily'])
  })

  it('falls back to the site-wide limit when the outfall\'s own is not yet in force', () => {
    const siteWide = limit({ id: 'site' })
    const later = limit({ id: 'later', outfallId: OF1, effectiveFrom: '2027-01-01' })
    expect(ids(limitsApplying([siteWide, later], result({ outfallId: OF1 })))).toEqual(['site'])
  })

  it('applies nothing to a result whose time cannot be read', () => {
    expect(limitsApplying([limit()], result({ sampledAt: 'not a time' }))).toEqual([])
  })

  it('reads the day in UTC', () => {
    const dated = limit({ id: 'dated', effectiveFrom: '2026-07-01' })
    expect(ids(limitsApplying([dated], result({ sampledAt: '2026-06-30T23:00:00-07:00' })))).toEqual(['dated'])
  })
})

describe('judgeResult', () => {
  it('judges against each limit that binds and is judged by sample, each with its own verdict', () => {
    const permit = limit({ id: 'permit', basis: 'permit_limit', value: 150 })
    const benchmark = limit({ id: 'benchmark', basis: 'benchmark', value: 100 })
    const annual = limit({ id: 'annual', kind: 'annual_average', value: 50 })
    const judged = judgeResult([permit, benchmark, annual], result({ value: 120 }))
    expect(judged.map(j => [j.limit.id, j.evaluation.status])).toEqual([['permit', 'within'], ['benchmark', 'exceeds']])
  })
})

describe('reportingYearFor', () => {
  it('runs a July-to-June year, and a day either side of the turn belongs to different years', () => {
    expect(reportingYearFor('2026-06-30', 7)).toEqual({ reportingYearStart: '2025-07-01', reportingYearEnd: '2026-06-30', label: '2025-26' })
    expect(reportingYearFor('2026-07-01', 7)).toEqual({ reportingYearStart: '2026-07-01', reportingYearEnd: '2027-06-30', label: '2026-27' })
  })

  it('puts January to June in the year that began the previous July, and July to December in the one that ends next June', () => {
    expect(reportingYearFor('2026-01-01', 7).reportingYearStart).toBe('2025-07-01')
    expect(reportingYearFor('2026-12-31', 7).reportingYearEnd).toBe('2027-06-30')
  })

  it('runs a calendar year when it starts in January', () => {
    expect(reportingYearFor('2026-03-01', 1)).toEqual({ reportingYearStart: '2026-01-01', reportingYearEnd: '2026-12-31', label: '2026' })
    expect(reportingYearFor('2026-12-31', 1).reportingYearStart).toBe('2026-01-01')
  })

  it('ends a year that starts in March on the last day of February, leap or not', () => {
    expect(reportingYearFor('2024-02-29', 3)).toEqual({ reportingYearStart: '2023-03-01', reportingYearEnd: '2024-02-29', label: '2023-24' })
    expect(reportingYearFor('2025-02-28', 3).reportingYearEnd).toBe('2025-02-28')
    expect(reportingYearFor('2024-03-01', 3).reportingYearEnd).toBe('2025-02-28')
  })

  it('reads a timestamp as the UTC day it falls on', () => {
    expect(reportingYearFor('2026-06-30T23:30:00-07:00', 7).reportingYearStart).toBe('2026-07-01')
    expect(reportingYearFor('2026-06-30T23:30:00Z', 7).reportingYearStart).toBe('2025-07-01')
  })

  it('refuses a month that does not exist and a date that is not one', () => {
    for (const month of [0, 13, 1.5, Number.NaN]) expect(() => reportingYearFor('2026-01-01', month)).toThrow(RangeError)
    for (const date of ['2026-02-30', 'soon', '']) expect(() => reportingYearFor(date, 7)).toThrow(RangeError)
  })
})

describe('annualAverage', () => {
  const year = reportingYearFor('2026-03-01', 7)
  const at = (sampledAt: string, value: number, over: Partial<MonitoringResult> = {}) => result({ sampledAt, value, ...over })

  it('is the arithmetic mean of the results in the window, with how many went into it', () => {
    const average = annualAverage([at('2025-08-01T00:00:00Z', 10), at('2025-12-01T00:00:00Z', 20), at('2026-02-01T00:00:00Z', 60)], year, 'mg/L')
    expect(average).toEqual({ unit: 'mg/L', sampleCount: 3, mean: 30, nonDetectCount: 0, includesNonDetects: false, incompatibleUnitCount: 0 })
  })

  it('includes the first and last day of the window and nothing outside it', () => {
    const average = annualAverage([
      at('2025-06-30T23:59:59Z', 1000),
      at('2025-07-01T00:00:00Z', 10),
      at('2026-06-30T23:59:59Z', 30),
      at('2026-07-01T00:00:00Z', 1000),
    ], year, 'mg/L')
    expect(average).toMatchObject({ sampleCount: 2, mean: 20 })
  })

  it('has no mean for no samples, and for one sample it is that sample', () => {
    expect(annualAverage([], year, 'mg/L')).toMatchObject({ sampleCount: 0, mean: null, includesNonDetects: false })
    expect(annualAverage([at('2026-01-01T00:00:00Z', 42)], year, 'mg/L')).toMatchObject({ sampleCount: 1, mean: 42 })
  })

  it('counts a non-detect at its reporting limit as reported, and says it did', () => {
    const average = annualAverage([at('2026-01-01T00:00:00Z', 10), at('2026-02-01T00:00:00Z', 20, { belowDetection: true })], year, 'mg/L')
    expect(average).toMatchObject({ sampleCount: 2, mean: 15, nonDetectCount: 1, includesNonDetects: true })
  })

  it('converts to the unit asked for, and leaves out, but counts, what it cannot convert', () => {
    const average = annualAverage([
      at('2026-01-01T00:00:00Z', 10),
      at('2026-02-01T00:00:00Z', 30000, { unit: 'ug/L' }),
      at('2026-03-01T00:00:00Z', 5, { unit: 'NTU' }),
    ], year, 'mg/L')
    expect(average).toMatchObject({ sampleCount: 2, mean: 20, incompatibleUnitCount: 1 })
  })
})

describe('evaluateAnnualAverage', () => {
  const year = reportingYearFor('2026-03-01', 7)
  const annual = (over: Partial<MonitoringLimit> = {}) => limit({ kind: 'annual_average', value: 100, ...over })
  const sample = (value: number, over: Partial<MonitoringResult> = {}) => result({ sampledAt: '2026-01-15T10:00:00Z', value, ...over })

  it('is within below the limit and exactly at it, and exceeds past it', () => {
    expect(evaluateAnnualAverage(annual(), [sample(60), sample(80)], year)).toMatchObject({ status: 'within', margin: 30 })
    expect(evaluateAnnualAverage(annual(), [sample(100)], year)).toMatchObject({ status: 'within', margin: 0 })
    expect(evaluateAnnualAverage(annual(), [sample(100), sample(101)], year)).toMatchObject({ status: 'exceeds', margin: -0.5 })
  })

  it('judges the average, not each sample: one high sample among low ones can leave the average within', () => {
    expect(evaluateAnnualAverage(annual(), [sample(300), sample(10), sample(10), sample(10)], year).status).toBe('within')
  })

  it('states how many samples it averaged', () => {
    expect(evaluateAnnualAverage(annual(), [sample(60)], year).reason).toBe('Average of 1 sample')
    expect(evaluateAnnualAverage(annual(), [sample(60), sample(80)], year).reason).toBe('Average of 2 samples')
  })

  it('says when non-detects went in at their reporting limit', () => {
    const evaluation = evaluateAnnualAverage(annual(), [sample(60), sample(20, { belowDetection: true })], year)
    expect(evaluation.average).toMatchObject({ includesNonDetects: true, nonDetectCount: 1 })
    expect(evaluation.reason).toBe('Average of 2 samples, 1 of them not detected and counted at their reporting limit')
  })

  it('is not evaluable with no samples in the year, however many sit outside it', () => {
    const evaluation = evaluateAnnualAverage(annual(), [sample(500, { sampledAt: '2025-06-30T10:00:00Z' })], year)
    expect(evaluation).toMatchObject({ status: 'not_evaluable', margin: null, reason: 'No samples in this reporting year.' })
    expect(evaluation.average.sampleCount).toBe(0)
  })

  it('is not evaluable when some samples are in a unit that cannot be compared: a partial mean would be a false answer', () => {
    const evaluation = evaluateAnnualAverage(annual(), [sample(10), sample(5, { unit: 'NTU' })], year)
    expect(evaluation.status).toBe('not_evaluable')
    expect(evaluation.reason).toBe('1 result in this reporting year is in a unit that cannot be compared with mg/L.')
  })

  it('takes only its parameter, and a site-wide limit pools every outfall while an outfall\'s own takes just that outfall', () => {
    const results = [sample(40, { outfallId: OF1 }), sample(80, { outfallId: OF2 }), sample(999, { parameter: 'Zinc' }), sample(60, { outfallId: null })]
    expect(evaluateAnnualAverage(annual({ outfallId: null }), results, year).average).toMatchObject({ sampleCount: 3, mean: 60 })
    expect(evaluateAnnualAverage(annual({ outfallId: OF2 }), results, year).average).toMatchObject({ sampleCount: 1, mean: 80 })
  })

  it('refuses a limit that is not an annual average', () => {
    expect(evaluateAnnualAverage(limit({ kind: 'instantaneous_max' }), [sample(1)], year).status).toBe('not_evaluable')
  })
})

describe('exceedanceSummary', () => {
  const permit = limit({ id: 'permit', basis: 'permit_limit', value: 150 })
  const benchmark = limit({ id: 'benchmark', basis: 'benchmark', value: 100 })
  const sampled = (value: number, sampledAt: string, over: Partial<MonitoringResult> = {}) => result({ value, sampledAt, ...over })
  const row = (summary: ReturnType<typeof exceedanceSummary>, limitId: string, outfallId: string | null = OF1) =>
    summary.rows.find(r => r.limit.id === limitId && r.outfallId === outfallId)

  it('never adds a permit-limit exceedance to a benchmark exceedance: the counts are separate fields, with no total', () => {
    const summary = exceedanceSummary([permit, benchmark], [
      sampled(200, '2026-01-10T10:00:00Z'),   // past both
      sampled(120, '2026-02-10T10:00:00Z'),   // past the benchmark only
      sampled(50,  '2026-03-01T10:00:00Z'),
    ], NOW, calendarYear)

    expect(summary.totals).toEqual({ limit: 1, action: 2, internal: 0 })
    expect(Object.keys(summary.totals).sort()).toEqual(['action', 'internal', 'limit'])
    expect(summary.subjects).toEqual([{ outfallId: OF1, counts: { limit: 1, action: 2, internal: 0 } }])
  })

  it('counts a numeric action level with the benchmarks, a local limit with the permit limits, and a self-imposed target alone', () => {
    const limits = [
      limit({ id: 'nal', basis: 'numeric_action_level', value: 10 }),
      limit({ id: 'local', basis: 'local_limit', value: 10 }),
      limit({ id: 'internal', basis: 'self_imposed', value: 10 }),
    ]
    const summary = exceedanceSummary(limits, [sampled(11, '2026-01-10T10:00:00Z')], NOW, calendarYear)
    expect(summary.totals).toEqual({ limit: 1, action: 1, internal: 1 })
  })

  it('rolls up per outfall, with the site-level samples as their own subject', () => {
    const summary = exceedanceSummary([permit, benchmark], [
      sampled(200, '2026-01-10T10:00:00Z', { outfallId: OF2 }),
      sampled(120, '2026-01-11T10:00:00Z', { outfallId: OF1 }),
      sampled(300, '2026-01-12T10:00:00Z', { outfallId: null }),
    ], NOW, calendarYear)

    expect(summary.subjects).toEqual([
      { outfallId: null, counts: { limit: 1, action: 1, internal: 0 } },
      { outfallId: OF1, counts: { limit: 0, action: 1, internal: 0 } },
      { outfallId: OF2, counts: { limit: 1, action: 1, internal: 0 } },
    ])
    expect(summary.totals).toEqual({ limit: 2, action: 3, internal: 0 })
  })

  it('reports each limit per outfall: the current status, the samples judged, the exceedances and the latest one', () => {
    const summary = exceedanceSummary([benchmark], [
      sampled(120, '2026-01-10T10:00:00Z', { id: 'first' }),
      sampled(180, '2026-02-10T10:00:00Z', { id: 'second' }),
      sampled(60,  '2026-03-01T10:00:00Z', { id: 'third' }),
    ], NOW, calendarYear)

    expect(row(summary, 'benchmark')).toMatchObject({
      status: 'within', sampleCount: 3, exceedanceCount: 2,
      latestExceedance: { resultId: 'second', sampledAt: '2026-02-10T10:00:00Z', value: 180, unit: 'mg/L', margin: -80 },
    })
  })

  it('finds the latest exceedance whatever order the results arrive in', () => {
    const results = [
      sampled(180, '2026-02-10T10:00:00Z', { id: 'later' }),
      sampled(120, '2026-01-10T10:00:00Z', { id: 'earlier' }),
    ]
    const forward = exceedanceSummary([benchmark], results, NOW, calendarYear)
    const backward = exceedanceSummary([benchmark], [...results].reverse(), NOW, calendarYear)
    expect(row(forward, 'benchmark')?.latestExceedance?.resultId).toBe('later')
    expect(backward).toEqual(forward)
  })

  it('takes the status from the latest result that could be judged, so a later non-detect does not hide an exceedance', () => {
    const summary = exceedanceSummary([limit({ id: 'tight', value: 15 })], [
      sampled(30, '2026-01-10T10:00:00Z'),
      sampled(50, '2026-02-10T10:00:00Z', { belowDetection: true }),
    ], NOW, calendarYear)
    expect(row(summary, 'tight')).toMatchObject({ status: 'exceeds', sampleCount: 2, exceedanceCount: 1 })
  })

  it('is not evaluable when every result in the year was a non-detect it could not judge, and counts no exceedance', () => {
    const summary = exceedanceSummary([limit({ id: 'tight', value: 15 })], [sampled(50, '2026-02-10T10:00:00Z', { belowDetection: true })], NOW, calendarYear)
    expect(row(summary, 'tight')).toMatchObject({ status: 'not_evaluable', exceedanceCount: 0, latestExceedance: null })
    expect(summary.totals).toEqual({ limit: 0, action: 0, internal: 0 })
  })

  it('is not evaluable, with the reason, for a result in a unit that cannot be compared', () => {
    const summary = exceedanceSummary([benchmark], [sampled(500, '2026-02-10T10:00:00Z', { unit: 'NTU' })], NOW, calendarYear)
    expect(row(summary, 'benchmark')).toMatchObject({ status: 'not_evaluable', exceedanceCount: 0 })
    expect(row(summary, 'benchmark')?.reason).toMatch(/Unit mismatch/)
  })

  describe('the reporting year', () => {
    const results = [
      sampled(500, '2025-12-31T23:59:59Z'),
      sampled(500, '2026-01-01T00:00:00Z'),
      sampled(500, '2026-12-31T23:59:59Z'),
      sampled(500, '2027-01-01T00:00:00Z'),
    ]

    it('counts only the samples of the year that contains now, both ends included', () => {
      const summary = exceedanceSummary([benchmark], results, NOW, calendarYear)
      expect(summary.reportingYear).toEqual({ reportingYearStart: '2026-01-01', reportingYearEnd: '2026-12-31', label: '2026' })
      expect(row(summary, 'benchmark')).toMatchObject({ sampleCount: 2, exceedanceCount: 2 })
    })

    it('runs July to June when the site\'s year does', () => {
      const june30 = Date.parse('2026-06-30T23:00:00Z')
      const july1 = Date.parse('2026-07-01T00:00:00Z')
      const spring = sampled(500, '2026-05-01T10:00:00Z')
      const autumn = sampled(500, '2026-09-01T10:00:00Z')
      expect(row(exceedanceSummary([benchmark], [spring, autumn], june30, julyYear), 'benchmark')).toMatchObject({ sampleCount: 1 })
      expect(row(exceedanceSummary([benchmark], [spring, autumn], july1, julyYear), 'benchmark')).toMatchObject({ sampleCount: 1 })
      expect(exceedanceSummary([benchmark], [spring, autumn], july1, julyYear).reportingYear.label).toBe('2026-27')
    })
  })

  describe('limits with nothing to judge yet', () => {
    it('lists a limit with no results as no data, at its own outfall or for the site', () => {
      const summary = exceedanceSummary([limit({ id: 'own', outfallId: OF2 }), limit({ id: 'site' })], [], NOW, calendarYear)
      expect(row(summary, 'own', OF2)).toMatchObject({ status: 'no_data', sampleCount: 0, exceedanceCount: 0 })
      expect(row(summary, 'site', null)).toMatchObject({ status: 'no_data' })
      expect(summary.totals).toEqual({ limit: 0, action: 0, internal: 0 })
    })

    it('splits a site-wide limit into a row for each outfall that has results, not an extra empty one', () => {
      const summary = exceedanceSummary([limit({ id: 'site' })], [sampled(10, '2026-01-10T10:00:00Z', { outfallId: OF1 }), sampled(10, '2026-01-10T10:00:00Z', { outfallId: OF2 })], NOW, calendarYear)
      expect(summary.rows.map(r => [r.limit.id, r.outfallId])).toEqual([['site', OF1], ['site', OF2]])
    })

    it('leaves out a limit that is not in force at any time in the year', () => {
      const summary = exceedanceSummary([limit({ id: 'ended', effectiveTo: '2025-12-31' }), limit({ id: 'later', effectiveFrom: '2027-01-01' })], [], NOW, calendarYear)
      expect(summary.rows).toEqual([])
    })

    it('judges each sample by the limit in force on its day when a limit changed during the year', () => {
      const summary = exceedanceSummary([
        limit({ id: 'old', value: 150, effectiveTo: '2026-01-31' }),
        limit({ id: 'new', value: 100, effectiveFrom: '2026-02-01' }),
      ], [sampled(120, '2026-01-20T10:00:00Z'), sampled(120, '2026-02-20T10:00:00Z')], NOW, calendarYear)
      expect(row(summary, 'old')).toMatchObject({ sampleCount: 1, exceedanceCount: 0 })
      expect(row(summary, 'new')).toMatchObject({ sampleCount: 1, exceedanceCount: 1 })
    })
  })

  describe('limits judged over the year or over a day or month', () => {
    const annual = limit({ id: 'annual', kind: 'annual_average', value: 100, basis: 'numeric_action_level' })

    it('judges an annual average once for the year, pooling every outfall for a site-wide limit, as a numeric action level exceedance', () => {
      const summary = exceedanceSummary([annual], [
        sampled(200, '2026-01-10T10:00:00Z', { outfallId: OF1 }),
        sampled(60,  '2026-02-10T10:00:00Z', { outfallId: OF2 }),
      ], NOW, calendarYear)
      expect(summary.rows).toHaveLength(1)
      expect(row(summary, 'annual', null)).toMatchObject({
        status: 'exceeds', sampleCount: 2, exceedanceCount: 1, latestExceedance: null,
        average: { mean: 130, sampleCount: 2 },
      })
      expect(summary.totals).toEqual({ limit: 0, action: 1, internal: 0 })
      expect(summary.subjects).toEqual([{ outfallId: null, counts: { limit: 0, action: 1, internal: 0 } }])
    })

    it('is within, with no exceedance, when the average is under the value', () => {
      const summary = exceedanceSummary([annual], [sampled(40, '2026-01-10T10:00:00Z'), sampled(60, '2026-02-10T10:00:00Z')], NOW, calendarYear)
      expect(row(summary, 'annual', null)).toMatchObject({ status: 'within', exceedanceCount: 0 })
    })

    it('has no data when the year has no sample of the parameter', () => {
      const summary = exceedanceSummary([annual], [sampled(40, '2026-01-10T10:00:00Z', { parameter: 'Zinc' })], NOW, calendarYear)
      expect(row(summary, 'annual', null)).toMatchObject({ status: 'no_data', sampleCount: 0 })
    })

    it('is not evaluable, not no-data, when the year\'s samples are in a unit that cannot be compared', () => {
      const summary = exceedanceSummary([annual], [sampled(40, '2026-01-10T10:00:00Z', { unit: 'NTU' })], NOW, calendarYear)
      expect(row(summary, 'annual', null)).toMatchObject({ status: 'not_evaluable' })
    })

    it('lists a daily maximum and a monthly average as not evaluable, and says why, rather than leaving them out', () => {
      const summary = exceedanceSummary([limit({ id: 'daily', kind: 'daily_max' }), limit({ id: 'monthly', kind: 'monthly_average' })], [sampled(999, '2026-01-10T10:00:00Z')], NOW, calendarYear)
      expect(row(summary, 'daily', null)).toMatchObject({ status: 'not_evaluable', exceedanceCount: 0 })
      expect(row(summary, 'daily', null)?.reason).toMatch(/daily maximum limit is judged on the day value/)
      expect(row(summary, 'monthly', null)?.reason).toMatch(/monthly average limit is judged on the month value/)
      expect(summary.totals).toEqual({ limit: 0, action: 0, internal: 0 })
    })
  })

  it('orders rows by parameter, then kind, so the same data always reads the same way', () => {
    const summary = exceedanceSummary([
      limit({ id: 'z', parameter: 'Zinc' }),
      limit({ id: 'tss-max', parameter: 'TSS', kind: 'instantaneous_max' }),
      limit({ id: 'tss-min', parameter: 'TSS', kind: 'instantaneous_min' }),
      limit({ id: 'cu', parameter: 'Copper' }),
    ], [], NOW, calendarYear)
    expect(summary.rows.map(r => r.limit.id)).toEqual(['cu', 'tss-max', 'tss-min', 'z'])
  })

  it('gives the same summary however its inputs are ordered', () => {
    const limits = [permit, benchmark, limit({ id: 'annual', kind: 'annual_average', value: 90 })]
    const results = [
      sampled(200, '2026-01-10T10:00:00Z', { id: 'a', outfallId: OF1 }),
      sampled(110, '2026-01-10T10:00:00Z', { id: 'b', outfallId: OF2 }),
      sampled(40,  '2026-02-10T10:00:00Z', { id: 'c', outfallId: OF1 }),
      sampled(95,  '2026-02-11T10:00:00Z', { id: 'd', outfallId: null }),
    ]
    const expected = exceedanceSummary(limits, results, NOW, calendarYear)
    expect(exceedanceSummary([...limits].reverse(), [...results].reverse(), NOW, calendarYear)).toEqual(expected)
    expect(exceedanceSummary([limits[1]!, limits[2]!, limits[0]!], [results[2]!, results[0]!, results[3]!, results[1]!], NOW, calendarYear)).toEqual(expected)
  })

  it('does not read the clock: the year comes from nowMs alone', () => {
    const clock = vi.spyOn(Date, 'now')
    exceedanceSummary([benchmark], [sampled(500, '2026-01-10T10:00:00Z')], NOW, calendarYear)
    expect(clock).not.toHaveBeenCalled()
  })

  it('does not change the rows it was given', () => {
    const results = [sampled(200, '2026-02-10T10:00:00Z'), sampled(120, '2026-01-10T10:00:00Z')]
    const before = JSON.stringify(results)
    exceedanceSummary([benchmark], results, NOW, calendarYear)
    expect(JSON.stringify(results)).toBe(before)
  })
})

describe('validateMonitoringLimit', () => {
  const valid = { facility_id: SITE, parameter: 'TSS', unit: 'mg/L', limit_kind: 'annual_average', value: 100, basis: 'numeric_action_level' }
  const ok = (body: object) => {
    const r = validateMonitoringLimit(body)
    if (!r.ok) throw new Error(r.errors.join(' | '))
    return r.limit
  }
  const errors = (body: object, current?: Parameters<typeof validateMonitoringLimit>[1]) => {
    const r = validateMonitoringLimit(body, current)
    return r.ok ? [] : r.errors
  }

  it('accepts a minimal limit with the safe defaults', () => {
    expect(ok({ facility_id: SITE, parameter: 'pH', unit: 's.u.', value: 9 })).toEqual({
      facilityId: SITE, outfallId: null, permitId: null, parameter: 'pH', unit: 's.u.', kind: 'instantaneous_max', value: 9, basis: 'permit_limit',
      citation: null, verify: null, effectiveFrom: null, effectiveTo: null,
    })
  })

  it('accepts a fully described limit, trimming text and lower-casing ids', () => {
    const limit = ok({
      ...valid, parameter: '  Oil &   grease ', outfall_id: OF1.toUpperCase(), permit_id: OF2, citation: ' IGP Table 2 ', verify: 'Check it',
      effective_from: '2026-07-01', effective_to: '2027-06-30',
    })
    expect(limit).toMatchObject({
      parameter: 'Oil & grease', outfallId: OF1, permitId: OF2, citation: 'IGP Table 2', verify: 'Check it', effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30',
    })
  })

  it('allows zero and refuses a negative, non-finite, text or absurdly large value', () => {
    expect(ok({ ...valid, value: 0 }).value).toBe(0)
    for (const value of [-1, Number.NaN, Infinity, '100', null, true, 1e13]) expect(errors({ ...valid, value }), String(value)).toEqual([expect.stringMatching(/^value must be a number from 0 to/)])
    expect(errors({ facility_id: SITE, parameter: 'TSS', unit: 'mg/L' })).toEqual(['value is required.'])
  })

  it('requires a parameter and a unit, and bounds them', () => {
    expect(errors({ ...valid, parameter: '   ' })).toEqual(['parameter is required.'])
    expect(errors({ ...valid, unit: undefined })).toEqual(['unit is required.'])
    expect(errors({ ...valid, parameter: 'p'.repeat(81) })).toEqual(['parameter is too long (the limit is 80 characters).'])
    expect(errors({ ...valid, unit: 'u'.repeat(21) })).toEqual(['unit is too long (the limit is 20 characters).'])
    expect(errors({ ...valid, parameter: 5 })).toEqual(['parameter must be text.'])
  })

  it('refuses a kind or basis it does not know, rather than dropping it', () => {
    expect(errors({ ...valid, limit_kind: 'weekly' })[0]).toMatch(/limit_kind must be one of: instantaneous_max/)
    expect(errors({ ...valid, basis: 'guideline' })[0]).toMatch(/basis must be one of: permit_limit, benchmark/)
  })

  it('needs a site, and an id that is an id', () => {
    expect(errors({ ...valid, facility_id: undefined })).toEqual(['facility_id is required: this record belongs to one site.'])
    expect(errors({ ...valid, facility_id: 'nope' })).toEqual(['facility_id must be an id.'])
    expect(errors({ ...valid, outfall_id: 'nope' })).toEqual(['outfall_id must be an id.'])
    expect(errors({ ...valid, permit_id: 5 })).toEqual(['permit_id must be an id.'])
  })

  it('checks the dates are real days, in order, and lets them be equal', () => {
    expect(errors({ ...valid, effective_from: '2026-02-30' })).toEqual(['effective_from must be a date such as 2026-07-01.'])
    expect(errors({ ...valid, effective_to: '07/01/2026' })).toEqual(['effective_to must be a date such as 2026-07-01.'])
    expect(errors({ ...valid, effective_from: '2026-07-01', effective_to: '2026-06-30' })).toEqual(['effective_to cannot be before effective_from.'])
    expect(ok({ ...valid, effective_from: '2026-07-01', effective_to: '2026-07-01' }).effectiveTo).toBe('2026-07-01')
  })

  it('does not take a source or a library key from a request: a person cannot claim a library limit by asking', () => {
    const limit = ok({ ...valid, source: 'library', library_key: 'x' })
    expect(limit).not.toHaveProperty('source')
    expect(toLimitRow(limit)).not.toHaveProperty('source')
    expect(toLimitRow(limit)).not.toHaveProperty('library_key')
  })

  it('rejects what is not an object', () => {
    for (const input of [null, 'x', [], 5]) expect(validateMonitoringLimit(input)).toEqual({ ok: false, errors: ['Expected an object.'] })
  })

  it('reports every problem at once', () => {
    expect(errors({ parameter: '', unit: '', value: -1, basis: 'x', limit_kind: 'y' }).length).toBe(6)
  })

  describe('a partial update', () => {
    const current = ok({ ...valid, outfall_id: OF1, citation: 'IGP', effective_from: '2026-07-01' })

    it('keeps what was not sent and changes what was', () => {
      const r = validateMonitoringLimit({ value: 120 }, { current })
      expect(r).toEqual({ ok: true, limit: { ...current, value: 120 } })
    })

    it('clears a field only when it is sent as null', () => {
      const r = validateMonitoringLimit({ outfall_id: null, citation: null }, { current })
      expect(r).toEqual({ ok: true, limit: { ...current, outfallId: null, citation: null } })
    })

    it('checks the dates against the stored ones', () => {
      expect(errors({ effective_to: '2026-06-30' }, { current })).toEqual(['effective_to cannot be before effective_from.'])
    })

    it('does not make the stored limit invalid by leaving it alone', () => {
      expect(validateMonitoringLimit({}, { current })).toEqual({ ok: true, limit: current })
    })
  })
})

describe('validateMonitoringResult', () => {
  const body = { facility_id: SITE, parameter: 'TSS', unit: 'mg/L', value: 42, sampled_at: '2026-02-03T10:30:00Z' }
  const options = { nowMs: NOW, evidencePathPrefix: `${TENANT}/` }
  const ok = (input: object, extra: Partial<Parameters<typeof validateMonitoringResult>[1]> = {}) => {
    const r = validateMonitoringResult(input, { ...options, ...extra })
    if (!r.ok) throw new Error(r.errors.join(' | '))
    return r.result
  }
  const errors = (input: object, extra: Partial<Parameters<typeof validateMonitoringResult>[1]> = {}) => {
    const r = validateMonitoringResult(input, { ...options, ...extra })
    return r.ok ? [] : r.errors
  }

  it('accepts a minimal result with the safe defaults', () => {
    expect(ok(body)).toEqual({
      facilityId: SITE, outfallId: null, parameter: 'TSS', unit: 'mg/L', value: 42, belowDetection: false, sampledAt: '2026-02-03T10:30:00.000Z',
      eventLabel: null, lab: null, evidenceId: null, note: null,
    })
  })

  it('accepts a fully described result', () => {
    const result = ok({
      ...body, outfall_id: OF1, below_detection: true, event_label: ' QSE 2026-02-03 ', lab: 'Acme Labs', note: 'Grab sample at the weir',
      evidence_id: `${TENANT}/monitoring/lab-1.pdf`,
    })
    expect(result).toMatchObject({
      outfallId: OF1, belowDetection: true, eventLabel: 'QSE 2026-02-03', lab: 'Acme Labs', note: 'Grab sample at the weir', evidenceId: `${TENANT}/monitoring/lab-1.pdf`,
    })
  })

  describe('the time of the sample', () => {
    it('is stored as an instant in UTC, whatever offset it was given in', () => {
      expect(ok({ ...body, sampled_at: '2026-02-03T10:30:00-08:00' }).sampledAt).toBe('2026-02-03T18:30:00.000Z')
      expect(ok({ ...body, sampled_at: '2026-02-03T10:30Z' }).sampledAt).toBe('2026-02-03T10:30:00.000Z')
      expect(ok({ ...body, sampled_at: '2026-02-03T10:30:00.123456Z' }).sampledAt).toBe('2026-02-03T10:30:00.123Z')
    })

    it('is required, and must be a real date and time with a zone', () => {
      expect(errors({ ...body, sampled_at: undefined })).toEqual(['sampled_at is required.'])
      for (const sampled_at of ['2026-02-03', '2026-02-03T10:30:00', '2026-02-30T10:30:00Z', '2026-02-03T25:00:00Z', 'yesterday', 1770000000000, null]) {
        expect(errors({ ...body, sampled_at }), String(sampled_at)).toEqual(['sampled_at must be a date and time with a time zone, such as 2026-02-03T10:30:00Z.'])
      }
    })

    it('may be up to a day ahead of now, to allow for time zones and a fast clock, and not a moment more', () => {
      expect(FUTURE_ALLOWANCE_MS).toBe(86_400_000)
      const edge = new Date(NOW + 86_400_000).toISOString()
      expect(ok({ ...body, sampled_at: edge }).sampledAt).toBe(edge)
      expect(errors({ ...body, sampled_at: new Date(NOW + 86_400_001).toISOString() })).toEqual(['sampled_at cannot be more than a day in the future.'])
      expect(errors({ ...body, sampled_at: '2027-01-01T00:00:00Z' })).toEqual(['sampled_at cannot be more than a day in the future.'])
    })

    it('can be any time in the past', () => {
      expect(ok({ ...body, sampled_at: '2019-05-01T00:00:00Z' }).sampledAt).toBe('2019-05-01T00:00:00.000Z')
    })
  })

  it('needs a non-negative number for the value, and says it in the field\'s name', () => {
    expect(ok({ ...body, value: 0 }).value).toBe(0)
    expect(errors({ ...body, value: -0.1 })).toEqual([expect.stringMatching(/^value must be a number/)])
    expect(errors({ ...body, value: '42' })).toEqual([expect.stringMatching(/^value must be a number/)])
    expect(errors({ ...body, value: undefined })).toEqual(['value is required.'])
  })

  it('wants below_detection to be true or false, not "yes"', () => {
    expect(errors({ ...body, below_detection: 'yes' })).toEqual(['below_detection must be true or false.'])
  })

  it('bounds the free text', () => {
    expect(errors({ ...body, lab: 'l'.repeat(121) })).toEqual(['lab is too long (the limit is 120 characters).'])
    expect(errors({ ...body, event_label: 'e'.repeat(121) })).toEqual(['event_label is too long (the limit is 120 characters).'])
    expect(errors({ ...body, note: 'n'.repeat(2001) })).toEqual(['note is too long (the limit is 2000 characters).'])
  })

  describe('the evidence file', () => {
    const bad = 'evidence_id must be a file you uploaded to this account.'

    it('must be in the caller\'s own folder', () => {
      expect(ok({ ...body, evidence_id: `${TENANT}/a.pdf` }).evidenceId).toBe(`${TENANT}/a.pdf`)
      expect(errors({ ...body, evidence_id: '22222222-2222-2222-2222-222222222222/a.pdf' })).toEqual([bad])
      expect(errors({ ...body, evidence_id: 'a.pdf' })).toEqual([bad])
    })

    it('must be inside the folder: sharing the first characters of its name is not enough', () => {
      expect(errors({ ...body, evidence_id: `${TENANT}x/a.pdf` })).toEqual([bad])
      expect(errors({ ...body, evidence_id: TENANT })).toEqual([bad])
    })

    it('may not climb out of the folder or run past 300 characters', () => {
      expect(errors({ ...body, evidence_id: `${TENANT}/../x.pdf` })).toEqual([bad])
      expect(errors({ ...body, evidence_id: `${TENANT}/${'a'.repeat(300)}` })).toEqual([bad])
      expect(ok({ ...body, evidence_id: `${TENANT}/${'a'.repeat(300 - TENANT.length - 1)}` }).evidenceId).toHaveLength(300)
    })

    it('is refused outright when the caller has no folder to reference', () => {
      expect(errors({ ...body, evidence_id: `${TENANT}/a.pdf` }, { evidencePathPrefix: undefined })).toEqual([bad])
    })

    it('is cleared by null or an empty string', () => {
      expect(ok({ ...body, evidence_id: null }).evidenceId).toBeNull()
      expect(ok({ ...body, evidence_id: '' }).evidenceId).toBeNull()
    })
  })

  describe('a partial update', () => {
    const current = ok({ ...body, outfall_id: OF1, lab: 'Acme Labs', evidence_id: `${TENANT}/a.pdf` })

    it('keeps what was not sent and changes what was', () => {
      expect(validateMonitoringResult({ value: 43 }, { ...options, current })).toEqual({ ok: true, result: { ...current, value: 43 } })
    })

    it('does not re-check a stored time that is left alone', () => {
      const old = { ...current, sampledAt: '2019-05-01T00:00:00.000Z' }
      expect(validateMonitoringResult({ note: 'x' }, { ...options, current: old })).toMatchObject({ ok: true, result: { sampledAt: '2019-05-01T00:00:00.000Z' } })
    })

    it('holds a new time to the future rule', () => {
      expect(validateMonitoringResult({ sampled_at: '2027-01-01T00:00:00Z' }, { ...options, current })).toEqual({ ok: false, errors: ['sampled_at cannot be more than a day in the future.'] })
    })
  })

  it('rejects what is not an object', () => {
    expect(validateMonitoringResult('x', options)).toEqual({ ok: false, errors: ['Expected an object.'] })
  })
})

describe('table rows', () => {
  it('round-trips a limit through its columns', () => {
    const r = validateMonitoringLimit({
      facility_id: SITE, outfall_id: OF1, parameter: 'TSS', unit: 'mg/L', limit_kind: 'annual_average', value: 100, basis: 'benchmark',
      citation: 'c', verify: 'v', effective_from: '2026-07-01', effective_to: '2027-06-30',
    })
    if (!r.ok) throw new Error('invalid')
    const parsed = parseLimitRow({ id: 'l1', source: 'library', library_key: 'k', ...toLimitRow(r.limit) })
    expect(parsed).toEqual({ ...r.limit, id: 'l1', source: 'library', libraryKey: 'k' })
  })

  it('round-trips a result through its columns', () => {
    const r = validateMonitoringResult({ facility_id: SITE, outfall_id: OF1, parameter: 'pH', unit: 's.u.', value: 7.1, sampled_at: '2026-02-03T10:30:00Z', below_detection: false, lab: 'L' }, { nowMs: NOW })
    if (!r.ok) throw new Error('invalid')
    expect(parseResultRow({ id: 'r1', sampled_by: 'u1', ...toResultRow(r.result) })).toEqual({ ...r.result, id: 'r1', sampledBy: 'u1' })
  })

  it('reads a numeric column that arrives as text, and a source it does not know as a tenant\'s', () => {
    const row = parseLimitRow({ id: 'l', facility_id: SITE, parameter: 'TSS', unit: 'mg/L', limit_kind: 'instantaneous_max', value: '12.5', basis: 'benchmark', source: 'import' })
    expect(row).toMatchObject({ value: 12.5, source: 'tenant', libraryKey: null, outfallId: null })
    expect(parseResultRow({ id: 'r', facility_id: SITE, parameter: 'TSS', unit: 'mg/L', value: '3.25', sampled_at: '2026-02-03T10:30:00+00:00' })).toMatchObject({ value: 3.25, belowDetection: false, sampledBy: null })
  })
})
