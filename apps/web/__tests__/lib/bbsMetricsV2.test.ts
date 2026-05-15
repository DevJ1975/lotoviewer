import { describe, it, expect } from 'vitest'
import {
  summarizeObservations,
  bandRatio,
  type BbsObservationV2Row,
} from '@soteria/core/bbsMetricsV2'

// Helpers to keep fixtures compact. `obs()` defaults every optional
// field to a sensible "nothing happened yet" value so each test
// overrides only the field under exam.

function obs(over: Partial<BbsObservationV2Row> = {}): BbsObservationV2Row {
  return {
    id:        'o1',
    category:  'safe_behavior',
    severity:  'minor',
    follow_up_required:     false,
    follow_up_completed_at: null,
    feedback_given_at:      null,
    created_at: '2026-05-15T12:00:00.000Z',
    ...over,
  }
}

describe('summarizeObservations', () => {
  it('returns zero counts on empty input', () => {
    const s = summarizeObservations([])
    expect(s.total).toBe(0)
    expect(s.safeBehaviorCount).toBe(0)
    expect(s.unsafeCount).toBe(0)
    expect(s.safeToUnsafeRatio).toBeNull()
    expect(s.followUpsDue).toBe(0)
    expect(s.feedbackDelivered).toBe(0)
  })

  it('counts each category separately', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ category: 'safe_behavior' }),
      obs({ category: 'safe_behavior' }),
      obs({ category: 'safe_behavior' }),
      obs({ category: 'unsafe_act' }),
      obs({ category: 'unsafe_condition' }),
    ]
    const s = summarizeObservations(rows)
    expect(s.safeBehaviorCount).toBe(3)
    expect(s.unsafeActCount).toBe(1)
    expect(s.unsafeConditionCount).toBe(1)
    expect(s.unsafeCount).toBe(2)
    expect(s.total).toBe(5)
  })

  it('computes the safe-to-unsafe ratio', () => {
    const rows: BbsObservationV2Row[] = [
      ...Array(8).fill(0).map(() => obs({ category: 'safe_behavior' })),
      obs({ category: 'unsafe_act' }),
      obs({ category: 'unsafe_condition' }),
    ]
    const s = summarizeObservations(rows)
    expect(s.safeToUnsafeRatio).toBe(4)
  })

  it('returns null ratio when unsafe count is zero', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ category: 'safe_behavior' }),
      obs({ category: 'safe_behavior' }),
    ]
    expect(summarizeObservations(rows).safeToUnsafeRatio).toBeNull()
  })

  it('counts only follow-ups that are required and not yet completed', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ follow_up_required: true,  follow_up_completed_at: null }),                          // due
      obs({ follow_up_required: true,  follow_up_completed_at: '2026-05-15T13:00:00.000Z' }),    // done
      obs({ follow_up_required: false, follow_up_completed_at: null }),                          // not required
    ]
    expect(summarizeObservations(rows).followUpsDue).toBe(1)
  })

  it('counts feedback_given_at populated rows', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ feedback_given_at: '2026-05-15T13:00:00.000Z' }),
      obs({ feedback_given_at: null }),
      obs({ feedback_given_at: '2026-05-15T14:00:00.000Z' }),
    ]
    expect(summarizeObservations(rows).feedbackDelivered).toBe(2)
  })
})

describe('bandRatio', () => {
  it('returns red below 2:1', () => {
    expect(bandRatio(0)).toBe('red')
    expect(bandRatio(1)).toBe('red')
    expect(bandRatio(1.99)).toBe('red')
  })

  it('returns yellow between 2:1 (inclusive) and 4:1', () => {
    expect(bandRatio(2)).toBe('yellow')
    expect(bandRatio(3)).toBe('yellow')
    expect(bandRatio(3.99)).toBe('yellow')
  })

  it('returns green at or above 4:1', () => {
    expect(bandRatio(4)).toBe('green')
    expect(bandRatio(10)).toBe('green')
    expect(bandRatio(100)).toBe('green')
  })

  it('returns red for null / undefined / NaN / negative', () => {
    expect(bandRatio(null)).toBe('red')
    expect(bandRatio(undefined)).toBe('red')
    expect(bandRatio(Number.NaN)).toBe('red')
    expect(bandRatio(-1)).toBe('red')
  })

  it('handles the exact threshold boundaries deterministically', () => {
    // The cutoff rules are inclusive on the lower bound, exclusive on
    // the upper. This guards against off-by-one drift if someone
    // edits the helper.
    expect(bandRatio(1.999999)).toBe('red')
    expect(bandRatio(2.0)).toBe('yellow')
    expect(bandRatio(3.999999)).toBe('yellow')
    expect(bandRatio(4.0)).toBe('green')
  })
})
