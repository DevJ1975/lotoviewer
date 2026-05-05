import { describe, it, expect } from 'vitest'
import {
  computeBandDistribution,
  computeHierarchyDistribution,
  computeHighOrExtremeWithoutPlan,
  computeOverdueReviewCount,
  computeTopResidualRisks,
  highestAppliedControlByRisk,
  type RiskRowForMetrics,
  type RiskControlForMetrics,
} from '@soteria/core/riskMetrics'

// All the riskMetrics.ts math tested without a DB. fetchRiskMetrics
// itself is a thin Supabase wrapper over these pure helpers; the
// helpers are where every regulatory-meaningful calculation lives.

function risk(over: Partial<RiskRowForMetrics> = {}): RiskRowForMetrics {
  return {
    id:                   'r1',
    risk_number:          'RSK-2026-0001',
    title:                'Test risk',
    status:               'open',
    hazard_category:      'mechanical',
    inherent_score:       12,
    inherent_band:        'high',
    residual_score:       6,
    residual_band:        'moderate',
    next_review_date:     null,
    ...over,
  }
}

describe('highestAppliedControlByRisk', () => {
  it('returns null for risks with no controls', () => {
    const out = highestAppliedControlByRisk([])
    expect(out.size).toBe(0)
  })

  it('picks the most-effective level when multiple controls are attached', () => {
    const controls: RiskControlForMetrics[] = [
      { risk_id: 'r1', hierarchy_level: 'ppe' },
      { risk_id: 'r1', hierarchy_level: 'engineering' },
      { risk_id: 'r1', hierarchy_level: 'administrative' },
    ]
    expect(highestAppliedControlByRisk(controls).get('r1')).toBe('engineering')
  })

  it('elimination beats every other level', () => {
    const controls: RiskControlForMetrics[] = [
      { risk_id: 'r2', hierarchy_level: 'ppe' },
      { risk_id: 'r2', hierarchy_level: 'elimination' },
      { risk_id: 'r2', hierarchy_level: 'engineering' },
    ]
    expect(highestAppliedControlByRisk(controls).get('r2')).toBe('elimination')
  })
})

describe('computeBandDistribution', () => {
  it('counts by residual band when residual is set', () => {
    const out = computeBandDistribution([
      risk({ id: 'a', residual_band: 'low' }),
      risk({ id: 'b', residual_band: 'low' }),
      risk({ id: 'c', residual_band: 'high' }),
    ])
    expect(out).toEqual({ low: 2, moderate: 0, high: 1, extreme: 0 })
  })

  it('falls back to inherent_band when residual is null', () => {
    const out = computeBandDistribution([
      risk({ id: 'a', residual_band: null, inherent_band: 'extreme' }),
    ])
    expect(out.extreme).toBe(1)
  })

  it('returns all-zeros for an empty list', () => {
    expect(computeBandDistribution([])).toEqual({ low: 0, moderate: 0, high: 0, extreme: 0 })
  })
})

describe('computeHierarchyDistribution', () => {
  it('counts risks by their highest applied control level', () => {
    const risks = [
      risk({ id: 'r1' }),
      risk({ id: 'r2' }),
      risk({ id: 'r3' }),
    ]
    const controls: RiskControlForMetrics[] = [
      { risk_id: 'r1', hierarchy_level: 'engineering' },
      { risk_id: 'r1', hierarchy_level: 'ppe' },
      { risk_id: 'r2', hierarchy_level: 'administrative' },
      // r3 has no controls
    ]
    const out = computeHierarchyDistribution(risks, controls)
    expect(out).toEqual({
      elimination: 0, substitution: 0, engineering: 1, administrative: 1, ppe: 0, none: 1,
    })
  })

  it('"none" bucket counts every risk with zero controls', () => {
    const risks = [risk({ id: 'a' }), risk({ id: 'b' })]
    const out = computeHierarchyDistribution(risks, [])
    expect(out.none).toBe(2)
  })
})

describe('computeOverdueReviewCount', () => {
  const NOW = new Date('2026-06-15T12:00:00Z')

  it('counts risks whose next_review_date is in the past', () => {
    const out = computeOverdueReviewCount([
      risk({ id: 'a', next_review_date: '2026-06-10' }),  // overdue
      risk({ id: 'b', next_review_date: '2026-06-15' }),  // today — not overdue
      risk({ id: 'c', next_review_date: '2026-07-01' }),  // future
      risk({ id: 'd', next_review_date: null }),          // no schedule yet
    ], NOW)
    expect(out).toBe(1)
  })

  it('skips closed and accepted_exception risks (no cadence applies)', () => {
    const out = computeOverdueReviewCount([
      risk({ id: 'a', next_review_date: '2026-06-10', status: 'closed' }),
      risk({ id: 'b', next_review_date: '2026-06-10', status: 'accepted_exception' }),
      risk({ id: 'c', next_review_date: '2026-06-10', status: 'open' }),
    ], NOW)
    expect(out).toBe(1)
  })
})

describe('computeHighOrExtremeWithoutPlan', () => {
  it('counts open High/Extreme risks with zero controls', () => {
    const risks = [
      risk({ id: 'r1', residual_band: 'high', status: 'open' }),         // counts
      risk({ id: 'r2', residual_band: 'extreme', status: 'open' }),      // counts
      risk({ id: 'r3', residual_band: 'moderate', status: 'open' }),     // band too low
      risk({ id: 'r4', residual_band: 'high', status: 'monitoring' }),   // wrong status
      risk({ id: 'r5', residual_band: 'high', status: 'open' }),         // has a control → no
    ]
    const controls: RiskControlForMetrics[] = [
      { risk_id: 'r5', hierarchy_level: 'engineering' },
    ]
    expect(computeHighOrExtremeWithoutPlan(risks, controls)).toBe(2)
  })

  it('falls back to inherent_band when residual is null', () => {
    const risks = [
      risk({ id: 'r1', residual_band: null, inherent_band: 'extreme', status: 'open' }),
    ]
    expect(computeHighOrExtremeWithoutPlan(risks, [])).toBe(1)
  })
})

describe('computeTopResidualRisks', () => {
  it('sorts by effective_score desc and limits to N', () => {
    const out = computeTopResidualRisks([
      risk({ id: 'a', residual_score: 6 }),
      risk({ id: 'b', residual_score: 25, residual_band: 'extreme' }),
      risk({ id: 'c', residual_score: 12, residual_band: 'high' }),
      risk({ id: 'd', residual_score: 4 }),
    ], 2)
    expect(out.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('uses inherent_score when residual is null', () => {
    const out = computeTopResidualRisks([
      risk({ id: 'a', residual_score: null, residual_band: null, inherent_score: 16, inherent_band: 'extreme' }),
      risk({ id: 'b', residual_score: 6 }),
    ], 1)
    expect(out[0]?.id).toBe('a')
    expect(out[0]?.effective_score).toBe(16)
  })

  it('excludes closed and accepted_exception risks', () => {
    const out = computeTopResidualRisks([
      risk({ id: 'a', residual_score: 25, status: 'closed' }),
      risk({ id: 'b', residual_score: 12, status: 'accepted_exception' }),
      risk({ id: 'c', residual_score: 6, status: 'open' }),
    ], 5)
    expect(out.map(r => r.id)).toEqual(['c'])
  })
})
