import { describe, it, expect } from 'vitest'
import { latestApprovedReviewByDept, computeDeptStats } from '@/lib/report'
import type { Equipment, LotoReview } from '@/lib/types'

function eq(partial: Partial<Equipment>): Equipment {
  return {
    equipment_id:       'EQ-001',
    description:        'Demo',
    department:         'Packaging',
    prefix:             null,
    photo_status:       'missing',
    has_equip_photo:    false,
    has_iso_photo:      false,
    equip_photo_url:    null,
    iso_photo_url:      null,
    placard_url:        null,
    signed_placard_url: null,
    notes:              null,
    notes_es:           null,
    internal_notes:     null,
    spanish_reviewed:   false,
    verified:           false,
    verified_date:      null,
    verified_by:        null,
    needs_equip_photo:  true,
    needs_iso_photo:    true,
    needs_verification: false,
    decommissioned:     false,
    annotations:        [],
    iso_annotations:        [],
    created_at:         '2026-01-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
    ...partial,
  }
}

function review(partial: Partial<LotoReview>): LotoReview {
  return {
    id:             'r-1',
    department:     'Packaging',
    reviewer_name:  'Jamil',
    reviewer_email: 'jamil@x.com',
    signed_at:      '2026-04-01T12:00:00Z',
    approved:       true,
    notes:          null,
    created_at:     '2026-04-01T12:00:00Z',
    ...partial,
  }
}

// ── latestApprovedReviewByDept ────────────────────────────────────────────

describe('latestApprovedReviewByDept', () => {
  it('returns an empty map when there are no reviews', () => {
    expect(latestApprovedReviewByDept([]).size).toBe(0)
  })

  it('returns an empty map when none of the reviews are approved', () => {
    const out = latestApprovedReviewByDept([review({ approved: false })])
    expect(out.size).toBe(0)
  })

  it('keeps the most-recent approved review per dept', () => {
    const r1 = review({ id: 'r1', department: 'Pack', created_at: '2026-04-01T00:00:00Z' })
    const r2 = review({ id: 'r2', department: 'Pack', created_at: '2026-04-15T00:00:00Z' })
    const out = latestApprovedReviewByDept([r1, r2])
    expect(out.get('Pack')?.id).toBe('r2')
  })

  it('handles unsorted input — picks newest regardless of array order', () => {
    const r1 = review({ id: 'r1', department: 'Pack', created_at: '2026-04-15T00:00:00Z' })
    const r2 = review({ id: 'r2', department: 'Pack', created_at: '2026-04-01T00:00:00Z' })
    const out = latestApprovedReviewByDept([r2, r1])  // older first
    expect(out.get('Pack')?.id).toBe('r1')
  })

  it('skips unapproved reviews even when newer than approved ones', () => {
    const old = review({ id: 'old',  approved: true,  created_at: '2026-04-01T00:00:00Z' })
    const fresh = review({ id: 'new', approved: false, created_at: '2026-04-15T00:00:00Z' })
    const out = latestApprovedReviewByDept([old, fresh])
    expect(out.get('Packaging')?.id).toBe('old')
  })

  it('treats null created_at as "older than anything else" via empty-string fallback', () => {
    const a = review({ id: 'a', created_at: null as unknown as string })
    const b = review({ id: 'b', created_at: '2026-04-01T00:00:00Z' })
    const out = latestApprovedReviewByDept([a, b])
    expect(out.get('Packaging')?.id).toBe('b')
  })

  it('keys by department string — different depts coexist', () => {
    const a = review({ id: 'a', department: 'Pack' })
    const b = review({ id: 'b', department: 'Label' })
    const out = latestApprovedReviewByDept([a, b])
    expect(out.size).toBe(2)
  })
})

// ── computeDeptStats ──────────────────────────────────────────────────────

describe('computeDeptStats', () => {
  it('returns an empty array when there is no equipment', () => {
    expect(computeDeptStats([], [])).toEqual([])
  })

  it('groups by department and counts photo statuses', () => {
    const list = [
      eq({ equipment_id: 'A1', department: 'Pack', photo_status: 'complete' }),
      eq({ equipment_id: 'A2', department: 'Pack', photo_status: 'partial'  }),
      eq({ equipment_id: 'A3', department: 'Pack', photo_status: 'missing'  }),
      eq({ equipment_id: 'B1', department: 'Label', photo_status: 'complete' }),
    ]
    const out = computeDeptStats(list, [])
    expect(out).toHaveLength(2)
    const pack = out.find(d => d.dept === 'Pack')!
    expect(pack.total).toBe(3)
    expect(pack.complete).toBe(1)
    expect(pack.partial).toBe(1)
    expect(pack.missing).toBe(1)
    expect(pack.pct).toBe(33)  // 1 / 3 → 33% rounded
  })

  it('rounds percentage to nearest integer (no fractional %)', () => {
    const list = [
      eq({ equipment_id: 'A1', photo_status: 'complete' }),
      eq({ equipment_id: 'A2', photo_status: 'complete' }),
      eq({ equipment_id: 'A3', photo_status: 'missing'  }),
    ]
    expect(computeDeptStats(list, [])[0].pct).toBe(67)  // 2/3 → 66.67 → 67
  })

  it('reports 100% when every row is complete', () => {
    const list = [
      eq({ equipment_id: 'A1', photo_status: 'complete' }),
      eq({ equipment_id: 'A2', photo_status: 'complete' }),
    ]
    expect(computeDeptStats(list, [])[0].pct).toBe(100)
  })

  it('reports 0% when no row is complete', () => {
    const list = [
      eq({ equipment_id: 'A1', photo_status: 'missing' }),
      eq({ equipment_id: 'A2', photo_status: 'partial' }),
    ]
    expect(computeDeptStats(list, [])[0].pct).toBe(0)
  })

  it('marks signedOff when the latest approved review for that dept exists', () => {
    const list = [eq({ equipment_id: 'A1', department: 'Pack' })]
    const reviews = [review({ department: 'Pack', reviewer_name: 'Maria' })]
    const out = computeDeptStats(list, reviews)
    expect(out[0].signedOff).toBe(true)
    expect(out[0].signedOffBy).toBe('Maria')
  })

  it('leaves signedOff false when the dept has no approved review', () => {
    const list = [eq({ equipment_id: 'A1', department: 'Pack' })]
    const reviews = [review({ department: 'Pack', approved: false })]
    const out = computeDeptStats(list, reviews)
    expect(out[0].signedOff).toBe(false)
    expect(out[0].signedOffBy).toBeNull()
  })

  it('uses the most-recent approved reviewer when multiple exist', () => {
    const list = [eq({ equipment_id: 'A1', department: 'Pack' })]
    const reviews = [
      review({ department: 'Pack', reviewer_name: 'Old',   created_at: '2026-04-01T00:00:00Z' }),
      review({ department: 'Pack', reviewer_name: 'Fresh', created_at: '2026-04-15T00:00:00Z' }),
    ]
    expect(computeDeptStats(list, reviews)[0].signedOffBy).toBe('Fresh')
  })

  it('sorts the output by department name ASC for stable PDF layout', () => {
    const list = [
      eq({ equipment_id: 'A', department: 'Zeta'  }),
      eq({ equipment_id: 'B', department: 'Alpha' }),
      eq({ equipment_id: 'C', department: 'Mu'    }),
    ]
    const order = computeDeptStats(list, []).map(d => d.dept)
    expect(order).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  it('does not include reviews for depts that have no equipment', () => {
    const list = [eq({ department: 'Pack' })]
    const reviews = [review({ department: 'GhostDept' })]
    const out = computeDeptStats(list, reviews)
    expect(out.map(d => d.dept)).toEqual(['Pack'])
  })

  it('reviewer_name null produces signedOffBy = null but signedOff = true', () => {
    // The review row exists and is approved — the dept IS signed off,
    // even if the name field is null. Edge case from older review rows.
    const list = [eq({ department: 'Pack' })]
    const reviews = [review({ department: 'Pack', reviewer_name: null })]
    const out = computeDeptStats(list, reviews)
    expect(out[0].signedOff).toBe(true)
    expect(out[0].signedOffBy).toBeNull()
  })
})
