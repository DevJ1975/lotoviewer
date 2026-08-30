import { describe, it, expect } from 'vitest'
import {
  summarizeObservations,
  bandRatio,
  tallyBehaviorTags,
  countRapidReviews,
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
    behavior_tags:             null,
    recognized:                false,
    rapid_review_required:     false,
    rapid_review_completed_at: null,
    action_team_id:            null,
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
    expect(s.recognizedCount).toBe(0)
    expect(s.rapidReviewsDue).toBe(0)
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

  it('counts recognized safe behaviors', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ category: 'safe_behavior', recognized: true }),
      obs({ category: 'safe_behavior', recognized: true }),
      obs({ category: 'safe_behavior', recognized: false }),
    ]
    expect(summarizeObservations(rows).recognizedCount).toBe(2)
  })

  it('counts only rapid reviews that are required and not yet completed', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ rapid_review_required: true,  rapid_review_completed_at: null }),                       // due
      obs({ rapid_review_required: true,  rapid_review_completed_at: '2026-05-15T13:00:00.000Z' }), // done
      obs({ rapid_review_required: false, rapid_review_completed_at: null }),                       // not required
    ]
    expect(summarizeObservations(rows).rapidReviewsDue).toBe(1)
  })
})

describe('tallyBehaviorTags', () => {
  it('seeds every catalog key at zero on empty input', () => {
    const t = tallyBehaviorTags([])
    expect(t.ppe).toBe(0)
    expect(t.line_of_fire).toBe(0)
    expect(t.housekeeping).toBe(0)
  })

  it('accumulates counts across rows with multiple tags', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ behavior_tags: ['ppe', 'housekeeping'] }),
      obs({ behavior_tags: ['ppe'] }),
      obs({ behavior_tags: null }),
    ]
    const t = tallyBehaviorTags(rows)
    expect(t.ppe).toBe(2)
    expect(t.housekeeping).toBe(1)
    expect(t.ergonomics).toBe(0)
  })

  it('ignores tags that are not in the catalog', () => {
    const rows: BbsObservationV2Row[] = [
      obs({ behavior_tags: ['ppe', 'retired_tag_key'] }),
    ]
    const t = tallyBehaviorTags(rows)
    expect(t.ppe).toBe(1)
    expect(Object.keys(t)).not.toContain('retired_tag_key')
  })
})

describe('countRapidReviews', () => {
  const NOW = new Date('2026-05-16T12:00:00.000Z')

  it('excludes reviews that are not required', () => {
    const rows = [obs({ rapid_review_required: false })]
    expect(countRapidReviews(rows, NOW)).toEqual({ due: 0, overdue: 0 })
  })

  it('excludes completed reviews', () => {
    const rows = [obs({ rapid_review_required: true, rapid_review_completed_at: '2026-05-16T01:00:00.000Z' })]
    expect(countRapidReviews(rows, NOW)).toEqual({ due: 0, overdue: 0 })
  })

  it('counts a fresh review as due but not overdue', () => {
    // created 1h before NOW, well within the 24h SLA
    const rows = [obs({ rapid_review_required: true, created_at: '2026-05-16T11:00:00.000Z' })]
    expect(countRapidReviews(rows, NOW)).toEqual({ due: 1, overdue: 0 })
  })

  it('counts an aged review as due AND overdue', () => {
    // created 25h before NOW, past the 24h SLA
    const rows = [obs({ rapid_review_required: true, created_at: '2026-05-15T11:00:00.000Z' })]
    expect(countRapidReviews(rows, NOW)).toEqual({ due: 1, overdue: 1 })
  })

  it('treats the exact 24h boundary as not yet overdue', () => {
    // created exactly 24h before NOW — strictly greater than SLA is overdue
    const rows = [obs({ rapid_review_required: true, created_at: '2026-05-15T12:00:00.000Z' })]
    expect(countRapidReviews(rows, NOW)).toEqual({ due: 1, overdue: 0 })
  })

  it('fails safe on an unparseable created_at: due but never overdue', () => {
    const rows = [obs({ rapid_review_required: true, created_at: 'not-a-date' })]
    expect(countRapidReviews(rows, NOW)).toEqual({ due: 1, overdue: 0 })
  })

  it('respects a custom SLA window', () => {
    // created 2h before NOW; overdue under a 1h SLA, fine under 24h
    const rows = [obs({ rapid_review_required: true, created_at: '2026-05-16T10:00:00.000Z' })]
    expect(countRapidReviews(rows, NOW, 1)).toEqual({ due: 1, overdue: 1 })
    expect(countRapidReviews(rows, NOW, 24)).toEqual({ due: 1, overdue: 0 })
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
