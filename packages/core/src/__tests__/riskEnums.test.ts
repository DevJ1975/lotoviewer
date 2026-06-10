import { describe, expect, it } from 'vitest'
import { HAZARD_CATEGORIES, RISK_STATUSES } from '../queries/risks'
import {
  HIERARCHY_LABELS,
  HIERARCHY_ORDER,
  RISK_ACTIVITY_TYPES,
  RISK_BANDS,
  RISK_EXPOSURE_FREQUENCIES,
} from '../risk'

// These arrays are the single source of truth the API routes validate
// against, but the DB check constraints hold the same literals
// independently. Pinning the values here means an edit to core that
// would desync app validation from the schema fails a test instead of
// surfacing as a 500 on insert.

describe('risk enum value lists (DB check-constraint contract)', () => {
  it('pins RISK_STATUSES', () => {
    expect(RISK_STATUSES).toEqual([
      'open', 'in_review', 'controls_in_progress', 'monitoring', 'closed', 'accepted_exception',
    ])
  })

  it('pins HAZARD_CATEGORIES', () => {
    expect(HAZARD_CATEGORIES).toEqual([
      'physical', 'chemical', 'biological', 'mechanical', 'electrical',
      'ergonomic', 'psychosocial', 'environmental', 'radiological',
    ])
  })

  it('pins RISK_BANDS', () => {
    expect(RISK_BANDS).toEqual(['low', 'moderate', 'high', 'extreme'])
  })

  it('pins RISK_ACTIVITY_TYPES and RISK_EXPOSURE_FREQUENCIES', () => {
    expect(RISK_ACTIVITY_TYPES).toEqual(['routine', 'non_routine', 'emergency'])
    expect(RISK_EXPOSURE_FREQUENCIES).toEqual(['continuous', 'daily', 'weekly', 'monthly', 'rare'])
  })

  it('keeps HIERARCHY_ORDER most-effective-first with a label for every level', () => {
    expect(HIERARCHY_ORDER).toEqual(['elimination', 'substitution', 'engineering', 'administrative', 'ppe'])
    expect(Object.keys(HIERARCHY_LABELS).sort()).toEqual([...HIERARCHY_ORDER].sort())
  })

  it('contains no duplicates in any list', () => {
    for (const list of [RISK_STATUSES, HAZARD_CATEGORIES, RISK_BANDS, RISK_ACTIVITY_TYPES, RISK_EXPOSURE_FREQUENCIES, HIERARCHY_ORDER]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })
})
