import { describe, it, expect } from 'vitest'
import { summarizeRecordableDistribution } from './scorecardDistribution'

// This summary is the shared contract behind both the Excel Distribution tab and
// the PDF distribution section. Locking its values + null boundaries here is what
// guarantees the two exports can't drift.

describe('summarizeRecordableDistribution', () => {
  it('computes descriptive stats + c-chart for a symmetric series', () => {
    // [2,4,6]: mean 4, median 4, sample stdDev 2, cv 0.5, skewness 0 (symmetric).
    // c-chart: c̄=4, ±3√4=±6 → UCL 10, LCL floored at 0.
    const d = summarizeRecordableDistribution([2, 4, 6])
    expect(d.n).toBe(3)
    expect(d.mean).toBe(4)
    expect(d.median).toBe(4)
    expect(d.stdDev).toBe(2)
    expect(d.cv).toBe(0.5)
    expect(d.skewness).toBeCloseTo(0, 10)
    expect(d.min).toBe(2)
    expect(d.max).toBe(6)
    expect(d.cChart).toEqual({ centerLine: 4, ucl: 10, lcl: 0 })
    expect(d.forecast).toBeNull() // needs ≥ 6 months
  })

  it('returns all-null for an empty series (no NaN)', () => {
    const d = summarizeRecordableDistribution([])
    expect(d).toEqual({
      n: 0, mean: null, median: null, stdDev: null, cv: null,
      skewness: null, min: null, max: null, cChart: null, forecast: null,
    })
  })

  it('degrades for a single month — value but no spread/limits/forecast', () => {
    const d = summarizeRecordableDistribution([3])
    expect(d.n).toBe(1)
    expect(d.mean).toBe(3)
    expect(d.median).toBe(3)
    expect(d.min).toBe(3)
    expect(d.max).toBe(3)
    expect(d.stdDev).toBeNull()   // n < 2
    expect(d.cv).toBeNull()
    expect(d.skewness).toBeNull() // n < 3
    expect(d.cChart).toBeNull()   // n < 2
    expect(d.forecast).toBeNull() // n < 6
  })

  it('produces a forecast once there are at least six months', () => {
    const d = summarizeRecordableDistribution([1, 2, 3, 4, 5, 6])
    expect(d.forecast).not.toBeNull()
    expect(d.forecast!.expected).toBeGreaterThanOrEqual(0)
    expect(d.forecast!.lower).toBeLessThanOrEqual(d.forecast!.expected)
    expect(d.forecast!.upper).toBeGreaterThanOrEqual(d.forecast!.expected)
  })
})
