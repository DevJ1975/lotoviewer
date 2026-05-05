import { describe, it, expect } from 'vitest'
import {
  selectActiveJhas,
  computeStatusDistribution,
  countOverdueReview,
  countHighOrExtremeHazards,
  computeTopByWorstCase,
  type JhaRowForMetrics,
} from '@soteria/core/jhaMetrics'
import type { JhaHazard } from '@soteria/core/jha'

function row(over: Partial<JhaRowForMetrics> = {}): JhaRowForMetrics {
  return {
    id:               'j-1',
    job_number:       'JHA-2026-0001',
    title:            'Belt change',
    status:           'approved',
    next_review_date: null,
    ...over,
  }
}

function hz(over: Partial<JhaHazard> = {}): JhaHazard {
  return {
    id:                 'h-1',
    tenant_id:          't-1',
    jha_id:             'j-1',
    step_id:            null,
    hazard_category:    'physical',
    description:        'pinch point',
    potential_severity: 'moderate',
    notes:              null,
    created_at:         '2026-04-01T00:00:00Z',
    ...over,
  }
}

describe('selectActiveJhas', () => {
  it('drops superseded entries', () => {
    const rows = [
      row({ id: 'a', status: 'draft' }),
      row({ id: 'b', status: 'in_review' }),
      row({ id: 'c', status: 'approved' }),
      row({ id: 'd', status: 'superseded' }),
    ]
    expect(selectActiveJhas(rows).map(r => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('computeStatusDistribution', () => {
  it('counts each status across the input', () => {
    const rows = [
      row({ status: 'draft' }),
      row({ status: 'draft' }),
      row({ status: 'approved' }),
      row({ status: 'superseded' }),
    ]
    expect(computeStatusDistribution(rows)).toEqual({
      draft: 2, in_review: 0, approved: 1, superseded: 1,
    })
  })
})

describe('countOverdueReview', () => {
  const now = new Date('2026-05-01T00:00:00Z')

  it('counts approved JHAs whose next_review_date is in the past', () => {
    const rows = [
      row({ id: 'a', status: 'approved', next_review_date: '2026-04-01' }),  // overdue
      row({ id: 'b', status: 'approved', next_review_date: '2026-06-01' }),  // not yet
      row({ id: 'c', status: 'approved', next_review_date: null }),          // never set
      row({ id: 'd', status: 'draft',    next_review_date: '2026-04-01' }),  // not approved
      row({ id: 'e', status: 'in_review', next_review_date: '2026-04-01' }), // not approved
    ]
    expect(countOverdueReview(rows, now)).toBe(1)
  })

  it('returns zero for empty input', () => {
    expect(countOverdueReview([], now)).toBe(0)
  })
})

describe('countHighOrExtremeHazards', () => {
  it('counts only hazards belonging to the active set', () => {
    const activeIds = new Set(['j-1', 'j-2'])
    const hazards = [
      hz({ jha_id: 'j-1', potential_severity: 'high' }),
      hz({ jha_id: 'j-1', potential_severity: 'low' }),
      hz({ jha_id: 'j-2', potential_severity: 'extreme' }),
      hz({ jha_id: 'j-3', potential_severity: 'extreme' }),     // not in active set
    ]
    expect(countHighOrExtremeHazards(activeIds, hazards)).toBe(2)
  })
})

describe('computeTopByWorstCase', () => {
  it('orders by worst severity desc, hazard_count desc, slices to N', () => {
    const rows = [
      row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }), row({ id: 'd' }),
    ]
    const hazards = [
      hz({ jha_id: 'a', potential_severity: 'low' }),
      hz({ jha_id: 'b', potential_severity: 'extreme' }),
      hz({ jha_id: 'b', potential_severity: 'high' }),     // b has 2 hazards
      hz({ jha_id: 'c', potential_severity: 'extreme' }),  // c has 1 (extreme too)
      hz({ jha_id: 'd', potential_severity: 'high' }),
    ]
    const top = computeTopByWorstCase(rows, hazards, 3).map(r => r.id)
    // b and c both extreme; b has more hazards → first. d high → 3rd.
    expect(top).toEqual(['b', 'c', 'd'])
  })

  it('places JHAs with no hazards last (worst_case=null)', () => {
    const rows = [row({ id: 'empty' }), row({ id: 'with-haz' })]
    const hazards = [hz({ jha_id: 'with-haz', potential_severity: 'low' })]
    const top = computeTopByWorstCase(rows, hazards, 5).map(r => r.id)
    expect(top).toEqual(['with-haz', 'empty'])
  })
})
