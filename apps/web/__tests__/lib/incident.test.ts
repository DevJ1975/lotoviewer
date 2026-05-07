import { describe, it, expect } from 'vitest'
import {
  compareForTriage,
  isActive,
  ageInDays,
  validateCreateInput,
  type IncidentRow,
} from '@soteria/core/incident'

// Pure-logic tests for packages/core/src/incident.ts. Runs cross-
// platform so no DOM/Node globals.

function row(over: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id:                                'r-1',
    tenant_id:                         't-1',
    report_number:                     'INC-2026-0001',
    incident_type:                     'injury_illness',
    occurred_at:                       '2026-04-01T12:00:00Z',
    reported_at:                       '2026-04-02T09:00:00Z',
    reported_by:                       'u-1',
    is_anonymous:                      false,
    location_text:                     null,
    location_geo:                      null,
    shift:                             null,
    description:                       'A worker was hurt',
    immediate_action_taken:            null,
    severity_actual:                   'first_aid',
    severity_potential:                'moderate',
    probability:                       'possible',
    classification_matrix_cell:        null,
    status:                            'reported',
    assigned_investigator:             null,
    related_loto_permit_id:            null,
    related_hot_work_permit_id:        null,
    related_confined_space_permit_id:  null,
    related_jha_id:                    null,
    workers_comp_claim_number:         null,
    spill_substance:                   null,
    spill_quantity:                    null,
    spill_quantity_unit:               null,
    legacy_near_miss_id:               null,
    closed_at:                         null,
    closed_by:                         null,
    created_at:                        '2026-04-02T09:00:00Z',
    updated_at:                        '2026-04-02T09:00:00Z',
    updated_by:                        null,
    ...over,
  }
}

describe('compareForTriage', () => {
  it('sorts catastrophic before fatality before lost_time', () => {
    const list = [
      row({ id: 'a', severity_actual: 'first_aid' }),
      row({ id: 'b', severity_actual: 'catastrophic' }),
      row({ id: 'c', severity_actual: 'lost_time' }),
      row({ id: 'd', severity_actual: 'fatality' }),
    ]
    list.sort(compareForTriage)
    expect(list.map(r => r.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('falls back to severity_potential for near-misses (severity_actual=none)', () => {
    const list = [
      row({ id: 'a', severity_actual: 'none', severity_potential: 'low' }),
      row({ id: 'b', severity_actual: 'none', severity_potential: 'extreme' }),
      row({ id: 'c', severity_actual: 'none', severity_potential: 'moderate' }),
    ]
    list.sort(compareForTriage)
    expect(list.map(r => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('within the same severity, oldest report bubbles up', () => {
    const list = [
      row({ id: 'a', severity_actual: 'medical', reported_at: '2026-04-10T00:00:00Z' }),
      row({ id: 'b', severity_actual: 'medical', reported_at: '2026-04-01T00:00:00Z' }),
      row({ id: 'c', severity_actual: 'medical', reported_at: '2026-04-05T00:00:00Z' }),
    ]
    list.sort(compareForTriage)
    expect(list.map(r => r.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('isActive', () => {
  it.each(['reported', 'triaged', 'investigating', 'pending_review', 'reopened'] as const)(
    'treats %s as active', s => {
      expect(isActive({ status: s })).toBe(true)
    },
  )

  it('treats closed as inactive', () => {
    expect(isActive({ status: 'closed' })).toBe(false)
  })
})

describe('ageInDays', () => {
  it('counts days between reported_at and a fixed now', () => {
    const r = row({ reported_at: '2026-04-01T00:00:00Z', closed_at: null })
    const now = new Date('2026-04-11T00:00:00Z')
    expect(ageInDays(r, now)).toBe(10)
  })

  it('uses closed_at when present', () => {
    const r = row({ reported_at: '2026-04-01T00:00:00Z', closed_at: '2026-04-04T00:00:00Z' })
    const now = new Date('2026-04-30T00:00:00Z')
    expect(ageInDays(r, now)).toBe(3)
  })

  it('never returns negative', () => {
    const r = row({ reported_at: '2026-04-10T00:00:00Z', closed_at: null })
    const now = new Date('2026-04-01T00:00:00Z')
    expect(ageInDays(r, now)).toBe(0)
  })
})

describe('validateCreateInput', () => {
  const ok = {
    incident_type: 'injury_illness' as const,
    occurred_at:   '2026-04-01T12:00:00Z',
    description:   'someone got hurt',
  }

  it('accepts a minimal valid input', () => {
    expect(validateCreateInput(ok)).toBeNull()
  })

  it('rejects missing incident_type', () => {
    expect(validateCreateInput({ ...ok, incident_type: undefined }))
      .toMatch(/incident type/i)
  })

  it('rejects unknown incident_type', () => {
    expect(validateCreateInput({ ...ok, incident_type: 'banana' as never }))
      .toMatch(/invalid incident type/i)
  })

  it('rejects empty description', () => {
    expect(validateCreateInput({ ...ok, description: '   ' }))
      .toMatch(/description/i)
  })

  it('rejects future occurred_at beyond clock-skew tolerance', () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString()  // +1 hour
    expect(validateCreateInput({ ...ok, occurred_at: future }))
      .toMatch(/future/i)
  })

  it('accepts occurred_at within 5-minute clock-skew tolerance', () => {
    const slightlyAhead = new Date(Date.now() + 2 * 60_000).toISOString()
    expect(validateCreateInput({ ...ok, occurred_at: slightlyAhead })).toBeNull()
  })

  it('rejects malformed occurred_at', () => {
    expect(validateCreateInput({ ...ok, occurred_at: 'not-a-date' }))
      .toMatch(/timestamp/i)
  })

  it('rejects near-miss with non-none severity_actual', () => {
    expect(validateCreateInput({
      ...ok,
      incident_type:   'near_miss',
      severity_actual: 'medical',
    })).toMatch(/near-miss/i)
  })

  it('accepts near-miss with severity_actual=none', () => {
    expect(validateCreateInput({
      ...ok,
      incident_type:   'near_miss',
      severity_actual: 'none',
    })).toBeNull()
  })

  it('rejects negative spill_quantity', () => {
    expect(validateCreateInput({
      ...ok,
      incident_type:  'environmental',
      spill_quantity: -5,
    })).toMatch(/non-negative/i)
  })

  it('rejects unknown spill_quantity_unit', () => {
    expect(validateCreateInput({
      ...ok,
      incident_type:       'environmental',
      spill_quantity_unit: 'pints' as never,
    })).toMatch(/spill_quantity_unit/i)
  })
})
