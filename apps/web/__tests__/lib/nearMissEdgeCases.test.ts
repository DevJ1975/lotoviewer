import { describe, it, expect } from 'vitest'
import {
  compareForTriage,
  ageInDays,
  validateCreateInput,
  deriveInherentScore,
  isActive,
  ACTIVE_NEAR_MISS_STATUSES,
  NEAR_MISS_STATUSES,
  NEAR_MISS_HAZARD_CATEGORIES,
  NEAR_MISS_SEVERITY_BANDS,
  type NearMissRow,
  type NearMissStatus,
} from '@soteria/core/nearMiss'

// Edge cases beyond the happy-path tests in nearMiss.test.ts.

function row(over: Partial<NearMissRow> = {}): NearMissRow {
  return {
    id: 'r', tenant_id: 't', report_number: 'NM-2026-0001',
    occurred_at: '2026-04-01T12:00:00Z',
    reported_at: '2026-04-02T09:00:00Z',
    reported_by: 'u', location: null,
    description: 'desc', immediate_action_taken: null,
    hazard_category: 'physical', severity_potential: 'moderate',
    status: 'new', assigned_to: null, linked_risk_id: null,
    resolved_at: null, resolution_notes: null,
    created_at: '2026-04-02T09:00:00Z',
    updated_at: '2026-04-02T09:00:00Z', updated_by: null,
    ...over,
  }
}

describe('Near-miss enum const arrays', () => {
  it('NEAR_MISS_STATUSES has all 5 lifecycle states', () => {
    expect(NEAR_MISS_STATUSES).toEqual([
      'new', 'triaged', 'investigating', 'closed', 'escalated_to_risk',
    ])
  })

  it('ACTIVE_NEAR_MISS_STATUSES is the working subset (3 of 5)', () => {
    expect(ACTIVE_NEAR_MISS_STATUSES).toEqual(['new', 'triaged', 'investigating'])
  })

  it('every active status is also a valid status', () => {
    for (const s of ACTIVE_NEAR_MISS_STATUSES) {
      expect((NEAR_MISS_STATUSES as readonly string[]).includes(s)).toBe(true)
    }
  })

  it('hazard categories match risk + JHA taxonomies', () => {
    expect(NEAR_MISS_HAZARD_CATEGORIES).toEqual([
      'physical', 'chemical', 'biological', 'mechanical', 'electrical',
      'ergonomic', 'psychosocial', 'environmental', 'radiological',
    ])
  })

  it('severity bands are the 4-band scheme', () => {
    expect(NEAR_MISS_SEVERITY_BANDS).toEqual(['low', 'moderate', 'high', 'extreme'])
  })
})

describe('isActive — every status', () => {
  it.each(['new', 'triaged', 'investigating'] as const)('%s → true', s => {
    expect(isActive({ status: s })).toBe(true)
  })

  it.each(['closed', 'escalated_to_risk'] as const)('%s → false', s => {
    expect(isActive({ status: s })).toBe(false)
  })
})

describe('compareForTriage stability', () => {
  it('is stable across N=20 same-severity rows (FIFO by reported_at)', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({
        id: `r${i}`, severity_potential: 'high',
        // Reverse-chronological insert; sort should produce ascending.
        reported_at: `2026-04-${String(20 - i).padStart(2, '0')}T00:00:00Z`,
      }),
    )
    rows.sort(compareForTriage)
    const orderByDate = rows.map(r => r.reported_at)
    const sorted = [...orderByDate].sort()
    expect(orderByDate).toEqual(sorted)
  })

  it('moves a single extreme to the front of 100 lows', () => {
    const rows: NearMissRow[] = Array.from({ length: 100 }, (_, i) =>
      row({ id: `low${i}`, severity_potential: 'low', reported_at: `2026-04-01T00:00:00Z` }),
    )
    rows.push(row({ id: 'the-extreme', severity_potential: 'extreme', reported_at: '2026-04-30T00:00:00Z' }))
    rows.sort(compareForTriage)
    expect(rows[0].id).toBe('the-extreme')
  })
})

describe('ageInDays edge cases', () => {
  it('returns 0 when reported_at equals now', () => {
    const r = row({ reported_at: '2026-04-01T12:00:00Z', resolved_at: null })
    expect(ageInDays(r, new Date('2026-04-01T12:00:00Z'))).toBe(0)
  })

  it('returns 0 — never negative — when reported_at is in the future', () => {
    const r = row({ reported_at: '2026-05-01T00:00:00Z', resolved_at: null })
    expect(ageInDays(r, new Date('2026-04-01T00:00:00Z'))).toBe(0)
  })

  it('handles century boundary correctly', () => {
    const r = row({ reported_at: '1999-12-31T00:00:00Z', resolved_at: '2000-01-01T00:00:00Z' })
    expect(ageInDays(r)).toBe(1)
  })

  it('handles daylight-saving boundary correctly (UTC math, no surprise)', () => {
    const r = row({
      reported_at: '2026-03-08T00:00:00Z',  // US spring-forward day
      resolved_at: '2026-03-09T00:00:00Z',
    })
    expect(ageInDays(r)).toBe(1)
  })
})

describe('validateCreateInput edge cases', () => {
  function valid() {
    return {
      occurred_at:        '2026-04-01T12:00:00Z',
      description:        'A real near-miss',
      hazard_category:    'physical' as const,
      severity_potential: 'moderate' as const,
    }
  }

  it('accepts each documented hazard category', () => {
    for (const c of NEAR_MISS_HAZARD_CATEGORIES) {
      expect(validateCreateInput({ ...valid(), hazard_category: c })).toBeNull()
    }
  })

  it('accepts each documented severity band', () => {
    for (const s of NEAR_MISS_SEVERITY_BANDS) {
      expect(validateCreateInput({ ...valid(), severity_potential: s })).toBeNull()
    }
  })

  it('accepts ISO timestamp at the exact 5-min skew boundary', () => {
    const exactly5min = new Date(Date.now() + 5 * 60_000 - 1).toISOString()
    expect(validateCreateInput({ ...valid(), occurred_at: exactly5min })).toBeNull()
  })

  it('rejects a moment past the 5-min skew boundary', () => {
    const past5min = new Date(Date.now() + 5 * 60_000 + 1000).toISOString()
    expect(validateCreateInput({ ...valid(), occurred_at: past5min })).toMatch(/cannot be in the future/)
  })

  it('rejects unicode-only description (treated as empty after trim)', () => {
    expect(validateCreateInput({ ...valid(), description: '   \t  \n' })).toMatch(/Description/)
  })

  it('accepts description with newlines + special characters', () => {
    expect(validateCreateInput({
      ...valid(),
      description: 'Line 1\nLine 2 with H₂S exposure ⚠️',
    })).toBeNull()
  })
})

describe('deriveInherentScore — full coverage', () => {
  it.each([
    ['low',      2],
    ['moderate', 3],
    ['high',     4],
    ['extreme',  5],
  ] as const)('%s → severity %i, likelihood always 3', (sev, expSev) => {
    const r = deriveInherentScore(sev)
    expect(r.severity).toBe(expSev)
    expect(r.likelihood).toBe(3)
  })

  it('produces scores that land in matching-or-stricter bands', () => {
    // low (S=2 × L=3 = 6) → moderate band
    // moderate (3 × 3 = 9) → high band
    // high (4 × 3 = 12) → high band
    // extreme (5 × 3 = 15) → extreme band
    const scores = ['low', 'moderate', 'high', 'extreme'].map(s => {
      const r = deriveInherentScore(s as never)
      return r.severity * r.likelihood
    })
    expect(scores).toEqual([6, 9, 12, 15])
  })
})
