import { describe, it, expect } from 'vitest'
import {
  detectPrecursors,
  precursorRuleCatalog,
  type PrecursorConditions,
  type PrecursorHistory,
} from '../precursorRules'

// A precursor rule makes a claim to a safety professional about where an
// incident is likely to come from. These tests describe the two promises that
// claim rests on: the rule only fires on its stated conjunction, and it never
// asserts lead time it has not measured.

const quiet: PrecursorConditions = {
  capasOverdue:           0,
  nearMissRecent:         0,
  recordablesRecent:      0,
  bbsUnsafe:              0,
  bbsFollowupsOpen:       0,
  inspectionsFailed:      0,
  inspectionsTotal:       0,
  trainingGaps:           0,
  permitExpiredOpen:      0,
  highRisksUncontrolled:  0,
  visionSignalsConfirmed: 0,
  visionSignalsSevere:    0,
}

const withConditions = (over: Partial<PrecursorConditions>): PrecursorConditions =>
  ({ ...quiet, ...over })

/** 18 months of an indicator's ups and downs. Not a straight rise: two series
 *  that merely trend together are exactly what lead/lag discovery discounts. */
const SWINGS = [2, 5, 1, 8, 3, 7, 2, 9, 4, 6, 1, 8, 5, 3, 7, 2, 6, 4]
/** Recordables that echo SWINGS one month later. */
const ECHO_1_MONTH_LATER = SWINGS.map((_, i) => (i === 0 ? 0 : SWINGS[i - 1]))

/** 18 months where recordables echo the indicator's swings 1 month later. */
const correlatedHistory = (condition: keyof PrecursorConditions): PrecursorHistory => ({
  recordablesMonthly: ECHO_1_MONTH_LATER,
  seriesByCondition: { [condition]: SWINGS },
})

describe('rule catalog', () => {
  it('states a premise for every rule', () => {
    // A rule with no written premise is an unfalsifiable number. This is the
    // string an auditor argues with, so it is not optional.
    const catalog = precursorRuleCatalog()
    expect(catalog.length).toBeGreaterThan(0)
    for (const rule of catalog) {
      expect(rule.basis.length, `basis for ${rule.key}`).toBeGreaterThan(60)
      expect(rule.label, `label for ${rule.key}`).toBeTruthy()
    }
  })

  it('has unique rule keys', () => {
    const keys = precursorRuleCatalog().map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('firing', () => {
  it('fires nothing on a quiet program', () => {
    expect(detectPrecursors(quiet).patterns).toEqual([])
  })

  it('requires the whole conjunction, not one half of it', () => {
    // Overdue CAPAs alone are already a risk driver. The precursor claim is
    // specifically about hazards left open WHILE workers keep reporting.
    expect(detectPrecursors(withConditions({ capasOverdue: 9 })).patterns).toEqual([])
    expect(detectPrecursors(withConditions({ nearMissRecent: 9 })).patterns).toEqual([])

    const both = detectPrecursors(withConditions({ capasOverdue: 3, nearMissRecent: 1 }))
    expect(both.patterns.map(p => p.key)).toEqual(['known_hazard_left_open'])
  })

  it('carries the evidence that justified the firing', () => {
    const { patterns } = detectPrecursors(withConditions({ capasOverdue: 4, nearMissRecent: 2 }))
    expect(patterns[0].evidence).toEqual([
      { label: 'Overdue corrective actions', value: '4' },
      { label: 'Near-misses this window',    value: '2' },
    ])
  })

  it('does not divide by zero when no inspections were graded', () => {
    expect(detectPrecursors(withConditions({ trainingGaps: 5 })).patterns).toEqual([])
  })

  it('needs a meaningful inspection sample before calling a fail rate', () => {
    // 1 of 1 failed is 100% and means nothing.
    const tiny = detectPrecursors(withConditions({
      inspectionsFailed: 1, inspectionsTotal: 1, trainingGaps: 2,
    }))
    expect(tiny.patterns).toEqual([])

    const real = detectPrecursors(withConditions({
      inspectionsFailed: 3, inspectionsTotal: 8, trainingGaps: 2,
    }))
    expect(real.patterns.map(p => p.key)).toEqual(['conditions_drifting_out_of_standard'])
  })

  it('ranks urgent above elevated', () => {
    const { patterns } = detectPrecursors(withConditions({
      permitExpiredOpen: 1,                          // urgent
      bbsFollowupsOpen: 6, bbsUnsafe: 4,             // elevated
    }))
    expect(patterns.map(p => p.severity)).toEqual(['urgent', 'elevated'])
  })

  it('is deterministic — same conditions, same output', () => {
    const c = withConditions({ capasOverdue: 3, nearMissRecent: 1, permitExpiredOpen: 2 })
    expect(detectPrecursors(c)).toEqual(detectPrecursors(c))
  })
})

describe('validation label', () => {
  const firing = withConditions({ capasOverdue: 3, nearMissRecent: 1 })

  it('claims no lead time without history', () => {
    const { patterns } = detectPrecursors(firing)
    expect(patterns[0].validation).toBe('unvalidated')
    expect(patterns[0].leadMonths).toBeNull()
    expect(patterns[0].historyMonths).toBe(0)
  })

  it('stays unvalidated when history is too short to correlate', () => {
    const { patterns } = detectPrecursors(firing, {
      recordablesMonthly: [1, 0, 2, 1],
      seriesByCondition:  { capasOverdue: [3, 4, 5, 6] },
    })
    expect(patterns[0].validation).toBe('unvalidated')
    expect(patterns[0].leadMonths).toBeNull()
  })

  it('validates and reports lead time when the tenant history supports it', () => {
    const { patterns } = detectPrecursors(firing, correlatedHistory('capasOverdue'))
    expect(patterns[0].validation).toBe('validated')
    expect(patterns[0].leadMonths).not.toBeNull()
    expect(patterns[0].historyMonths).toBeGreaterThanOrEqual(12)
  })

  it('labels a rule contradicted rather than hiding it', () => {
    // The indicator reliably moves the OPPOSITE way from the rule's premise.
    // That is a finding about the rule; burying it repeats the mistake of
    // burying a false positive.
    const { patterns } = detectPrecursors(firing, {
      recordablesMonthly: ECHO_1_MONTH_LATER,
      seriesByCondition:  { capasOverdue: SWINGS.map(v => 10 - v) },
    })
    expect(patterns[0].validation).toBe('contradicted')
    expect(patterns[0].leadMonths).toBeNull()
  })

  it('ranks a validated pattern above an unvalidated one of equal severity', () => {
    const bothUrgent = withConditions({
      capasOverdue: 3, nearMissRecent: 1,                              // validated below
      highRisksUncontrolled: 1, visionSignalsSevere: 2, visionSignalsConfirmed: 4,
    })
    const { patterns } = detectPrecursors(bothUrgent, correlatedHistory('capasOverdue'))
    expect(patterns).toHaveLength(2)
    expect(patterns[0].key).toBe('known_hazard_left_open')
    expect(patterns[0].validation).toBe('validated')
    expect(patterns[1].validation).toBe('unvalidated')
  })
})
