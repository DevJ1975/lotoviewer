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
