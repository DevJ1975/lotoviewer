import { describe, it, expect } from 'vitest'
import {
  forecastCount, cChartLimits, pChartLimits, projectAnnualTrir, assessTrend,
} from '../forecast'

describe('forecastCount', () => {
  it('returns null with too little history', () => {
    expect(forecastCount([1, 2, 3])).toBeNull()
  })

  it('applies a reliable upward trend with a Poisson interval', () => {
    const f = forecastCount([0, 1, 2, 3, 4, 5])!
    expect(f.hasTrend).toBe(true)
    expect(f.trendSlope).toBeCloseTo(1, 6)
    expect(f.expected).toBeGreaterThan(0)
    expect(f.lower).toBeGreaterThanOrEqual(0)
    expect(f.upper).toBeGreaterThan(f.expected)
    expect(f.basis).toBe(6)
  })

  it('suppresses the trend term when the fit is poor', () => {
    const f = forecastCount([3, 1, 4, 1, 5, 2])!
    expect(f.hasTrend).toBe(false)
    expect(f.trendSlope).toBe(0)
    expect(f.expected).toBeGreaterThanOrEqual(0)
  })
})

describe('control charts', () => {
  it('cChartLimits: CL = mean, 3σ Poisson band floored at 0', () => {
    const cl = cChartLimits([2, 4, 6])!
    expect(cl.centerLine).toBeCloseTo(4, 10)
    expect(cl.ucl).toBeCloseTo(4 + 3 * 2, 10)
    expect(cl.lcl).toBe(0)
    expect(cChartLimits([1])).toBeNull()
  })

  it('pChartLimits: proportion limits bounded to [0,1]', () => {
    const cl = pChartLimits(8, 10)!
    expect(cl.centerLine).toBeCloseTo(0.8, 10)
    expect(cl.ucl).toBeLessThanOrEqual(1)
    expect(cl.lcl).toBeGreaterThanOrEqual(0)
    expect(pChartLimits(0, 0)).toBeNull()
  })
})

describe('projectAnnualTrir', () => {
  it('extrapolates the YTD run-rate and flags off-track', () => {
    const p = projectAnnualTrir({ ytdRecordables: 5, ytdHours: 100_000, fractionOfYearElapsed: 0.5, target: 2, benchmark: 3.5 })
    expect(p.projectedTrir).toBeCloseTo(10, 10)
    expect(p.reliable).toBe(true)
    expect(p.onTrack).toBe(false)
  })

  it('is unreliable early in the year and null without hours', () => {
    expect(projectAnnualTrir({ ytdRecordables: 5, ytdHours: 100_000, fractionOfYearElapsed: 0.1 }).reliable).toBe(false)
    const noHours = projectAnnualTrir({ ytdRecordables: 5, ytdHours: 0, fractionOfYearElapsed: 0.5, target: 2 })
    expect(noHours.projectedTrir).toBeNull()
    expect(noHours.onTrack).toBeNull()
  })
})

describe('assessTrend', () => {
  it('reads a declining recordable series as improving (lower is better)', () => {
    const a = assessTrend([6, 5, 4, 3, 2, 1], { lowerIsBetter: true, target: 0 })!
    expect(a.reliable).toBe(true)
    expect(a.status).toBe('improving')
    expect(a.etaPeriods).not.toBeNull()
    expect(a.etaPeriods!).toBeGreaterThan(0)
  })

  it('falls back to flat when the trend is not reliable', () => {
    const a = assessTrend([3, 1, 4, 1, 5, 2], { lowerIsBetter: true })!
    expect(a.reliable).toBe(false)
    expect(a.status).toBe('flat')
    expect(a.slope).toBe(0)
  })

  it('returns null with too little history', () => {
    expect(assessTrend([1, 2, 3], { lowerIsBetter: true })).toBeNull()
  })
})
