import { describe, it, expect } from 'vitest'
import {
  evaluateTarget,
  compareToBenchmark,
  TARGET_METRICS,
  TARGET_METRIC_META,
} from '@soteria/core/ehsTargets'

describe('evaluateTarget', () => {
  it('treats at-or-below as on track when lower is better', () => {
    expect(evaluateTarget(1.8, 2.0, true).onTrack).toBe(true)   // under goal
    expect(evaluateTarget(2.0, 2.0, true).onTrack).toBe(true)   // exactly at goal
    expect(evaluateTarget(2.4, 2.0, true).onTrack).toBe(false)  // over goal
  })

  it('treats at-or-above as on track when higher is better', () => {
    expect(evaluateTarget(92, 90, false).onTrack).toBe(true)
    expect(evaluateTarget(85, 90, false).onTrack).toBe(false)
  })

  it('reports the signed % delta of current vs target', () => {
    expect(evaluateTarget(2.4, 2.0, true).deltaPct).toBeCloseTo(20)    // 20% over
    expect(evaluateTarget(1.6, 2.0, true).deltaPct).toBeCloseTo(-20)   // 20% under
  })

  it('returns null delta when target is 0 or current is null', () => {
    expect(evaluateTarget(5, 0, true).deltaPct).toBeNull()
    expect(evaluateTarget(null, 2.0, true)).toEqual({ onTrack: false, deltaPct: null })
  })
})

describe('compareToBenchmark', () => {
  it('is better than industry when at-or-below the industry rate', () => {
    expect(compareToBenchmark(2.1, 3.0).betterThanIndustry).toBe(true)
    expect(compareToBenchmark(3.0, 3.0).betterThanIndustry).toBe(true)
    expect(compareToBenchmark(3.4, 3.0).betterThanIndustry).toBe(false)
  })

  it('reports a negative delta when below the industry average', () => {
    expect(compareToBenchmark(2.1, 3.0).deltaPct).toBeCloseTo(-30)
    expect(compareToBenchmark(3.6, 3.0).deltaPct).toBeCloseTo(20)
  })

  it('returns null delta for a zero industry rate or null current', () => {
    expect(compareToBenchmark(2.0, 0).deltaPct).toBeNull()
    expect(compareToBenchmark(null, 3.0)).toEqual({ betterThanIndustry: false, deltaPct: null })
  })
})

describe('target metric metadata', () => {
  it('has metadata for every listed metric', () => {
    for (const m of TARGET_METRICS) {
      expect(TARGET_METRIC_META[m]).toBeDefined()
      expect(typeof TARGET_METRIC_META[m].label).toBe('string')
    }
  })

  it('only flags TRIR and DART as having an industry benchmark', () => {
    const withBenchmark = TARGET_METRICS.filter(m => TARGET_METRIC_META[m].hasBenchmark)
    expect(withBenchmark).toEqual(['trir', 'dart'])
  })

  it('marks rates/counts as lower-is-better and percentages as higher-is-better', () => {
    expect(TARGET_METRIC_META.trir.lowerIsBetter).toBe(true)
    expect(TARGET_METRIC_META.recordables.lowerIsBetter).toBe(true)
    expect(TARGET_METRIC_META.capa_on_time_pct.lowerIsBetter).toBe(false)
    expect(TARGET_METRIC_META.rca_completion_pct.lowerIsBetter).toBe(false)
  })
})
