import { describe, it, expect } from 'vitest'
import {
  compareForTriage,
  isActive,
  ageInDays,
  validateCreateInput,
  type NearMissRow,
} from '@soteria/core/nearMiss'

// Pure-logic tests for the near-miss helpers in packages/core. These
// run cross-platform (web + mobile) so the helpers must not reach
// for browser-only globals.

function row(over: Partial<NearMissRow> = {}): NearMissRow {
  return {
    id:                     'r-1',
    tenant_id:              't-1',
    report_number:          'NM-2026-0001',
    occurred_at:            '2026-04-01T12:00:00Z',
    reported_at:            '2026-04-02T09:00:00Z',
    reported_by:            'u-1',
    location:               null,
    description:            'someone slipped',
    immediate_action_taken: null,
    hazard_category:        'physical',
    severity_potential:     'moderate',
    status:                 'new',
    assigned_to:            null,
    linked_risk_id:         null,
    resolved_at:            null,
    resolution_notes:       null,
    created_at:             '2026-04-02T09:00:00Z',
    updated_at:             '2026-04-02T09:00:00Z',
    updated_by:             null,
    ...over,
  }
}

describe('compareForTriage', () => {
  it('sorts higher-severity reports earlier', () => {
    const list = [
      row({ id: 'a', severity_potential: 'low' }),
      row({ id: 'b', severity_potential: 'extreme' }),
      row({ id: 'c', severity_potential: 'moderate' }),
      row({ id: 'd', severity_potential: 'high' }),
    ]
    list.sort(compareForTriage)
    expect(list.map(r => r.id)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('within the same severity, oldest report bubbles up', () => {
    const list = [
      row({ id: 'a', severity_potential: 'high', reported_at: '2026-04-10T00:00:00Z' }),
      row({ id: 'b', severity_potential: 'high', reported_at: '2026-04-01T00:00:00Z' }),
      row({ id: 'c', severity_potential: 'high', reported_at: '2026-04-05T00:00:00Z' }),
    ]
    list.sort(compareForTriage)
    expect(list.map(r => r.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('isActive', () => {
  it.each(['new', 'triaged', 'investigating'] as const)('treats %s as active', s => {
    expect(isActive({ status: s })).toBe(true)
  })

  it.each(['closed', 'escalated_to_risk'] as const)('treats %s as inactive', s => {
    expect(isActive({ status: s })).toBe(false)
  })
})

describe('ageInDays', () => {
  it('counts days between reported_at and a fixed now', () => {
    const r = row({ reported_at: '2026-04-01T00:00:00Z', resolved_at: null })
    const now = new Date('2026-04-11T00:00:00Z')
    expect(ageInDays(r, now)).toBe(10)
  })

  it('uses resolved_at when present', () => {
    const r = row({
      reported_at: '2026-04-01T00:00:00Z',
      resolved_at: '2026-04-04T00:00:00Z',
    })
    const now = new Date('2026-04-30T00:00:00Z')
    expect(ageInDays(r, now)).toBe(3)
  })

  it('floors partial days', () => {
    const r = row({ reported_at: '2026-04-01T00:00:00Z', resolved_at: null })
    const now = new Date('2026-04-01T20:00:00Z')
    expect(ageInDays(r, now)).toBe(0)
  })

  it('clamps to zero when reported_at is in the future', () => {
    const r = row({ reported_at: '2026-05-01T00:00:00Z', resolved_at: null })
    const now = new Date('2026-04-01T00:00:00Z')
    expect(ageInDays(r, now)).toBe(0)
  })
})

describe('validateCreateInput', () => {
  function valid() {
    return {
      occurred_at:        '2026-04-01T12:00:00Z',
      description:        'Slipped near racking',
      hazard_category:    'physical' as const,
      severity_potential: 'moderate' as const,
    }
  }

  it('returns null on a complete payload', () => {
    expect(validateCreateInput(valid())).toBeNull()
  })

  it('rejects empty description', () => {
    expect(validateCreateInput({ ...valid(), description: '   ' })).toMatch(/Description/)
  })

  it('rejects missing hazard_category', () => {
    const v: Record<string, unknown> = { ...valid() }
    delete v.hazard_category
    expect(validateCreateInput(v)).toMatch(/Hazard category/)
  })

  it('rejects an invalid hazard_category', () => {
    expect(validateCreateInput({ ...valid(), hazard_category: 'bogus' as never }))
      .toMatch(/Invalid hazard category/)
  })

  it('rejects an invalid severity', () => {
    expect(validateCreateInput({ ...valid(), severity_potential: 'mid' as never }))
      .toMatch(/Invalid severity/)
  })

  it('rejects unparseable occurred_at', () => {
    expect(validateCreateInput({ ...valid(), occurred_at: 'not-a-date' }))
      .toMatch(/not a valid timestamp/)
  })

  it('rejects an occurred_at far in the future', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    expect(validateCreateInput({ ...valid(), occurred_at: future }))
      .toMatch(/cannot be in the future/)
  })

  it('allows occurred_at within the 5-minute clock-skew window', () => {
    const slight = new Date(Date.now() + 60 * 1000).toISOString()
    expect(validateCreateInput({ ...valid(), occurred_at: slight })).toBeNull()
  })
})
