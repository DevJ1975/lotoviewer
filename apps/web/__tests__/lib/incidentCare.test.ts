import { describe, it, expect } from 'vitest'
import {
  validateCareCasePatch,
  validateCareVisit,
  daysUntilFollowup,
  isCaseActive,
  CARE_CASE_STATUSES,
} from '@soteria/core/incidentCare'

describe('validateCareCasePatch', () => {
  it('accepts an empty patch (no fields)', () => {
    expect(validateCareCasePatch({})).toBeNull()
  })

  it('rejects unknown case_status', () => {
    expect(validateCareCasePatch({ case_status: 'wishful' as never }))
      .toMatch(/case_status/i)
  })

  it('rejects negative day counters', () => {
    expect(validateCareCasePatch({ days_away_from_work: -1 }))
      .toMatch(/days_away/i)
  })

  it('rejects non-integer day counters', () => {
    expect(validateCareCasePatch({ days_lost: 3.5 }))
      .toMatch(/days_lost/i)
  })

  it('rejects modified_duty_end before modified_duty_start', () => {
    expect(validateCareCasePatch({
      modified_duty_start: '2026-04-10T00:00:00Z',
      modified_duty_end:   '2026-04-05T00:00:00Z',
    })).toMatch(/modified_duty_end/i)
  })

  it('accepts equal modified_duty_start and end (single-day duty)', () => {
    expect(validateCareCasePatch({
      modified_duty_start: '2026-04-10T00:00:00Z',
      modified_duty_end:   '2026-04-10T00:00:00Z',
    })).toBeNull()
  })

  it('accepts every valid case_status', () => {
    for (const s of CARE_CASE_STATUSES) {
      expect(validateCareCasePatch({ case_status: s })).toBeNull()
    }
  })

  it('rejects restrictions that is not an array', () => {
    expect(validateCareCasePatch({ restrictions: 'no lifting' as never }))
      .toMatch(/array/i)
  })

  it('rejects unknown drug_test_status', () => {
    expect(validateCareCasePatch({ drug_test_status: 'maybe' as never }))
      .toMatch(/drug_test_status/i)
  })
})

describe('validateCareVisit', () => {
  it('accepts an empty visit (defaults applied server-side)', () => {
    expect(validateCareVisit({})).toBeNull()
  })

  it('rejects unknown visit_type', () => {
    expect(validateCareVisit({ visit_type: 'snail-mail' as never }))
      .toMatch(/visit_type/i)
  })

  it('rejects malformed visit_at', () => {
    expect(validateCareVisit({ visit_at: 'tomorrow' }))
      .toMatch(/timestamp/i)
  })
})

describe('daysUntilFollowup', () => {
  it('returns null when no follow-up scheduled', () => {
    expect(daysUntilFollowup({ next_followup_at: null })).toBeNull()
  })

  it('returns positive when in future', () => {
    expect(daysUntilFollowup(
      { next_followup_at: '2026-04-10T00:00:00Z' },
      new Date('2026-04-01T00:00:00Z'),
    )).toBe(9)
  })

  it('returns negative when overdue', () => {
    expect(daysUntilFollowup(
      { next_followup_at: '2026-04-01T00:00:00Z' },
      new Date('2026-04-05T00:00:00Z'),
    )).toBe(-4)
  })
})

describe('isCaseActive', () => {
  it.each(['open', 'modified_duty'] as const)(
    'treats %s as active', s => {
      expect(isCaseActive({ case_status: s })).toBe(true)
    },
  )

  it.each(['full_duty_returned', 'permanent_restrictions', 'closed'] as const)(
    'treats %s as inactive', s => {
      expect(isCaseActive({ case_status: s })).toBe(false)
    },
  )
})
