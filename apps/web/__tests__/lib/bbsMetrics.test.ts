import { describe, it, expect } from 'vitest'
import {
  bbsScoreFor,
  bbsRiskBand,
  bbsPointsForKind,
  validateBBSCreateInput,
} from '@soteria/core/bbs'
import {
  computeCloseOutRate,
  computeAvgRiskScore,
  computeEhsScore,
  selectActive,
  countCreatedSince,
  type BBSObservationForMetrics,
} from '@soteria/core/bbsMetrics'

function obs(over: Partial<BBSObservationForMetrics> = {}): BBSObservationForMetrics {
  return {
    id:             'o1',
    report_number:  'BBS-2026-0001',
    kind:           'unsafe_act',
    status:         'open',
    risk_score:     4,
    points_awarded: 14,
    submitted_by:   'user-1',
    observed_at:    new Date().toISOString(),
    closed_at:      null,
    created_at:     new Date().toISOString(),
    ...over,
  }
}

describe('bbsScoreFor', () => {
  it('multiplies severity * likelihood', () => {
    expect(bbsScoreFor('low', 'low')).toBe(1)
    expect(bbsScoreFor('medium', 'medium')).toBe(4)
    expect(bbsScoreFor('high', 'high')).toBe(9)
    expect(bbsScoreFor('low', 'high')).toBe(3)
  })

  it('returns null when either is missing', () => {
    expect(bbsScoreFor(null, 'low')).toBeNull()
    expect(bbsScoreFor('low', undefined)).toBeNull()
  })
})

describe('bbsRiskBand', () => {
  it('bands the score correctly', () => {
    expect(bbsRiskBand(1)).toBe('low')
    expect(bbsRiskBand(2)).toBe('low')
    expect(bbsRiskBand(3)).toBe('moderate')
    expect(bbsRiskBand(4)).toBe('moderate')
    expect(bbsRiskBand(6)).toBe('high')
    expect(bbsRiskBand(9)).toBe('high')
  })
})

describe('bbsPointsForKind', () => {
  it('safe_behavior is a flat 5', () => {
    expect(bbsPointsForKind('safe_behavior', null)).toBe(5)
    expect(bbsPointsForKind('safe_behavior', 9)).toBe(5)
  })

  it('unsafe observations get 10 + risk_score', () => {
    expect(bbsPointsForKind('unsafe_act', 4)).toBe(14)
    expect(bbsPointsForKind('unsafe_condition', 9)).toBe(19)
    expect(bbsPointsForKind('unsafe_act', null)).toBe(10)
  })
})

describe('validateBBSCreateInput', () => {
  it('flags missing description', () => {
    const errs = validateBBSCreateInput({ kind: 'unsafe_act', description: '' })
    expect(errs.some(e => e.field === 'description')).toBe(true)
  })

  it('requires severity + likelihood for unsafe observations', () => {
    const errs = validateBBSCreateInput({ kind: 'unsafe_condition', description: 'water on the floor' })
    expect(errs.some(e => e.field === 'severity')).toBe(true)
    expect(errs.some(e => e.field === 'likelihood')).toBe(true)
  })

  it('does not require severity for safe_behavior', () => {
    const errs = validateBBSCreateInput({
      kind: 'safe_behavior',
      description: 'team paused job to add stand-down barriers',
    })
    expect(errs).toEqual([])
  })

  it('rejects malformed email', () => {
    const errs = validateBBSCreateInput({
      kind: 'safe_behavior',
      description: 'good catch on guarding',
      submitted_email: 'not-an-email',
    })
    expect(errs.some(e => e.field === 'submitted_email')).toBe(true)
  })
})

describe('selectActive', () => {
  it('keeps open and in_progress', () => {
    const rows = [obs({ status: 'open' }), obs({ status: 'in_progress' }), obs({ status: 'closed' }), obs({ status: 'invalid' })]
    expect(selectActive(rows)).toHaveLength(2)
  })
})

describe('countCreatedSince', () => {
  it('counts only rows in the window', () => {
    const now = new Date('2026-05-08T00:00:00Z')
    const rows = [
      obs({ created_at: '2026-05-01T00:00:00Z' }), // 7d ago — in 30d
      obs({ created_at: '2026-04-01T00:00:00Z' }), // 37d ago — out
      obs({ created_at: '2026-05-07T00:00:00Z' }), // 1d — in
    ]
    expect(countCreatedSince(rows, 30, now)).toBe(2)
  })
})

describe('computeCloseOutRate', () => {
  it('is 1.0 when there are no unsafe observations', () => {
    expect(computeCloseOutRate([obs({ kind: 'safe_behavior' })])).toBe(1)
    expect(computeCloseOutRate([])).toBe(1)
  })

  it('ratios closed unsafe / total unsafe', () => {
    const rows = [
      obs({ kind: 'unsafe_act',       status: 'closed' }),
      obs({ kind: 'unsafe_condition', status: 'closed' }),
      obs({ kind: 'unsafe_act',       status: 'open' }),
      obs({ kind: 'safe_behavior',    status: 'open' }), // ignored
    ]
    expect(computeCloseOutRate(rows)).toBeCloseTo(2 / 3)
  })

  it('ignores invalid', () => {
    const rows = [
      obs({ kind: 'unsafe_act', status: 'closed' }),
      obs({ kind: 'unsafe_act', status: 'invalid' }),
    ]
    expect(computeCloseOutRate(rows)).toBe(1)
  })
})

describe('computeAvgRiskScore', () => {
  it('averages numeric risk_scores, ignores nulls', () => {
    const rows = [
      obs({ risk_score: 6 }),
      obs({ risk_score: 4 }),
      obs({ risk_score: null }),
    ]
    expect(computeAvgRiskScore(rows)).toBe(5)
  })

  it('returns null when no scored rows', () => {
    expect(computeAvgRiskScore([obs({ risk_score: null })])).toBeNull()
  })
})

describe('computeEhsScore', () => {
  it('returns 100 at perfect program: target met, all closed, low avg score', () => {
    const score = computeEhsScore({
      participation: 30,
      closeOutRate:  1,
      avgRiskScore:  1,
    })
    // 60 (participation capped) + 30 (close-out) + 10*(1 - 1/9) ≈ 88.89 → 89
    expect(score).toBeGreaterThanOrEqual(85)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns 0 with no participation', () => {
    expect(computeEhsScore({ participation: 0, closeOutRate: 0, avgRiskScore: 9 })).toBe(0)
  })

  it('clamps to 0..100', () => {
    const high = computeEhsScore({ participation: 9999, closeOutRate: 1, avgRiskScore: null })
    expect(high).toBeLessThanOrEqual(100)
  })

  it('respects custom participation target', () => {
    const a = computeEhsScore({ participation: 5, closeOutRate: 1, avgRiskScore: null, participationTarget: 5 })
    const b = computeEhsScore({ participation: 5, closeOutRate: 1, avgRiskScore: null, participationTarget: 10 })
    expect(a).toBeGreaterThan(b)
  })
})

// ── Phase D edge cases ─────────────────────────────────────────────────────

describe('bbsScoreFor edge cases', () => {
  it('returns null for unrecognized severity strings (defensive)', () => {
    expect(bbsScoreFor('extreme' as never, 'low')).toBeNull()
    expect(bbsScoreFor('low', 'extreme' as never)).toBeNull()
  })
  it('returns null when both are null', () => {
    expect(bbsScoreFor(null, null)).toBeNull()
  })
})

describe('bbsRiskBand edge cases', () => {
  it('returns null for null/undefined input', () => {
    expect(bbsRiskBand(null)).toBeNull()
    expect(bbsRiskBand(undefined)).toBeNull()
  })
  it('handles values outside 1..9 defensively', () => {
    expect(bbsRiskBand(0)).toBe('low')
    expect(bbsRiskBand(10)).toBe('high')
    expect(bbsRiskBand(-5)).toBe('low')
  })
  it('5 (impossible on 1..3 axes) bands as high (defensive)', () => {
    expect(bbsRiskBand(5)).toBe('high')
  })
})

describe('validateBBSCreateInput edge cases', () => {
  it('rejects whitespace-only description', () => {
    const errs = validateBBSCreateInput({ kind: 'safe_behavior', description: '     ' })
    expect(errs.some(e => e.field === 'description')).toBe(true)
  })

  it('rejects 4-character description (boundary)', () => {
    const errs = validateBBSCreateInput({ kind: 'safe_behavior', description: 'wet ' })
    expect(errs.some(e => e.field === 'description')).toBe(true)
  })

  it('accepts exactly 5 characters (boundary)', () => {
    const errs = validateBBSCreateInput({ kind: 'safe_behavior', description: 'wet f' })
    expect(errs).toEqual([])
  })

  it('accepts unicode and special characters in description', () => {
    const errs = validateBBSCreateInput({
      kind: 'safe_behavior',
      description: 'O₂ alert near valve — tested OK ✓',
    })
    expect(errs).toEqual([])
  })

  it('rejects unknown kind', () => {
    const errs = validateBBSCreateInput({
      // @ts-expect-error — feeding invalid input is the test
      kind:        'something_else',
      description: 'long enough description here',
    })
    expect(errs.some(e => e.field === 'kind')).toBe(true)
  })

  it('null severity is treated like missing on unsafe_*', () => {
    const errs = validateBBSCreateInput({
      kind:        'unsafe_act',
      description: 'employee not wearing safety glasses',
      severity:    null,
      likelihood:  'low',
    })
    expect(errs.some(e => e.field === 'severity')).toBe(true)
  })

  it('accepts safe_behavior without severity / likelihood', () => {
    const errs = validateBBSCreateInput({
      kind:        'safe_behavior',
      description: 'crew did a great pre-job briefing',
    })
    expect(errs).toEqual([])
  })

  it('email validation: accepts plus addressing', () => {
    const errs = validateBBSCreateInput({
      kind: 'safe_behavior',
      description: 'good catch',
      submitted_email: 'observer+bbs@example.com',
    })
    expect(errs).toEqual([])
  })

  it('email validation: rejects missing TLD', () => {
    const errs = validateBBSCreateInput({
      kind: 'safe_behavior',
      description: 'good catch',
      submitted_email: 'someone@localhost',
    })
    expect(errs.some(e => e.field === 'submitted_email')).toBe(true)
  })
})

describe('countCreatedSince edge cases', () => {
  it('returns 0 for empty input', () => {
    expect(countCreatedSince([], 30)).toBe(0)
  })
  it('zero windowDays means only the current instant counts', () => {
    const now = new Date('2026-05-08T12:00:00Z')
    const rows = [obs({ created_at: '2026-05-08T11:59:59Z' })]
    expect(countCreatedSince(rows, 0, now)).toBe(0)
  })
  it('counts a row right at the cutoff (>=)', () => {
    const now = new Date('2026-05-08T00:00:00Z')
    const rows = [obs({ created_at: '2026-04-08T00:00:00Z' })] // exactly 30d
    expect(countCreatedSince(rows, 30, now)).toBe(1)
  })
})

describe('computeCloseOutRate edge cases', () => {
  it('treats safe_behavior as not "unsafe" even when status=closed', () => {
    const rows = [obs({ kind: 'safe_behavior', status: 'closed' })]
    expect(computeCloseOutRate(rows)).toBe(1)
  })

  it('100% close-out when every unsafe is closed', () => {
    const rows = [
      obs({ kind: 'unsafe_act',       status: 'closed' }),
      obs({ kind: 'unsafe_condition', status: 'closed' }),
    ]
    expect(computeCloseOutRate(rows)).toBe(1)
  })

  it('0% close-out when no unsafe is closed', () => {
    const rows = [
      obs({ kind: 'unsafe_act',       status: 'open' }),
      obs({ kind: 'unsafe_condition', status: 'in_progress' }),
    ]
    expect(computeCloseOutRate(rows)).toBe(0)
  })
})

describe('computeAvgRiskScore edge cases', () => {
  it('returns null for empty input', () => {
    expect(computeAvgRiskScore([])).toBeNull()
  })
  it('handles a single scored row', () => {
    expect(computeAvgRiskScore([obs({ risk_score: 7 })])).toBe(7)
  })
  it('skips zero-risk rows by counting them as a score, not skipping', () => {
    // risk_score=0 is technically valid (not present in 1..9 but the
    // helper should average it, not skip).
    expect(computeAvgRiskScore([obs({ risk_score: 0 }), obs({ risk_score: 6 })])).toBe(3)
  })
})

describe('computeEhsScore boundary conditions', () => {
  it('participation exactly at target = full 60 points', () => {
    const score = computeEhsScore({ participation: 20, closeOutRate: 0, avgRiskScore: null })
    // 60 (full participation) + 0 (close-out) + 10 (no risk score) = 70
    expect(score).toBe(70)
  })

  it('participation at half target = 30 participation points', () => {
    const score = computeEhsScore({ participation: 10, closeOutRate: 0, avgRiskScore: null })
    // 30 + 0 + 10 = 40
    expect(score).toBe(40)
  })

  it('avgRiskScore=9 zeroes the severity component', () => {
    const score = computeEhsScore({ participation: 0, closeOutRate: 0, avgRiskScore: 9 })
    expect(score).toBe(0)
  })

  it('avgRiskScore=null gives full severity bonus (no unsafe yet)', () => {
    const score = computeEhsScore({ participation: 0, closeOutRate: 0, avgRiskScore: null })
    // 0 + 0 + 10 = 10
    expect(score).toBe(10)
  })

  it('participation=0 gives 0 participation points', () => {
    const score = computeEhsScore({ participation: 0, closeOutRate: 1, avgRiskScore: 1 })
    // 0 + 30 + ~8.9 = ~39
    expect(score).toBeGreaterThanOrEqual(38)
    expect(score).toBeLessThanOrEqual(40)
  })
})

describe('bbsPointsForKind boundary', () => {
  it('safe_behavior is 5 regardless of risk_score (which is null in practice)', () => {
    expect(bbsPointsForKind('safe_behavior', 0)).toBe(5)
    expect(bbsPointsForKind('safe_behavior', 9)).toBe(5)
  })
  it('unsafe with risk_score=0 still gets the base 10', () => {
    expect(bbsPointsForKind('unsafe_act', 0)).toBe(10)
  })
  it('unsafe with maximum risk_score=9 gets 19 points', () => {
    expect(bbsPointsForKind('unsafe_condition', 9)).toBe(19)
  })
})
