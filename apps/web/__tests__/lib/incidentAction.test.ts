import { describe, it, expect } from 'vitest'
import {
  validateActionCreate,
  canTransition,
  isClosedOnTime,
  daysUntilDue,
  HIERARCHY_RANK,
  type IncidentActionRow,
  type IncidentActionStatus,
} from '@soteria/core/incidentAction'

describe('validateActionCreate', () => {
  const ok = { action_type: 'corrective' as const, description: 'fix the guard' }

  it('accepts a minimal valid input', () => {
    expect(validateActionCreate(ok)).toBeNull()
  })

  it('rejects unknown action_type', () => {
    expect(validateActionCreate({ ...ok, action_type: 'banana' as never }))
      .toMatch(/action_type/i)
  })

  it('rejects empty description', () => {
    expect(validateActionCreate({ ...ok, description: '   ' }))
      .toMatch(/description/i)
  })

  it('rejects unknown hierarchy_of_controls', () => {
    expect(validateActionCreate({ ...ok, hierarchy_of_controls: 'wishful' as never }))
      .toMatch(/hierarchy/i)
  })

  it('rejects malformed due_at', () => {
    expect(validateActionCreate({ ...ok, due_at: 'not-a-date' }))
      .toMatch(/timestamp/i)
  })

  it('accepts valid due_at', () => {
    expect(validateActionCreate({ ...ok, due_at: '2026-12-01T12:00:00Z' })).toBeNull()
  })
})

describe('canTransition', () => {
  it('allows open → in_progress', () => {
    expect(canTransition('open', 'in_progress')).toBe(true)
  })

  it('allows in_progress → complete', () => {
    expect(canTransition('in_progress', 'complete')).toBe(true)
  })

  it('allows complete → verified', () => {
    expect(canTransition('complete', 'verified')).toBe(true)
  })

  it('allows verified → in_progress (failed re-audit)', () => {
    expect(canTransition('verified', 'in_progress')).toBe(true)
  })

  it('blocks open → verified (skipping the lifecycle)', () => {
    expect(canTransition('open', 'verified')).toBe(false)
  })

  it('blocks complete → open (rejection should go through in_progress)', () => {
    expect(canTransition('complete', 'open')).toBe(false)
  })

  it('treats no-op transitions as allowed', () => {
    for (const s of ['open', 'in_progress', 'verified'] as const) {
      expect(canTransition(s as IncidentActionStatus, s as IncidentActionStatus)).toBe(true)
    }
  })

  it('allows uncancellation (cancelled → open)', () => {
    expect(canTransition('cancelled', 'open')).toBe(true)
  })
})

describe('hierarchy of controls ranking', () => {
  it('ranks elimination above engineering above PPE', () => {
    expect(HIERARCHY_RANK.elimination).toBeLessThan(HIERARCHY_RANK.engineering)
    expect(HIERARCHY_RANK.engineering).toBeLessThan(HIERARCHY_RANK.ppe)
  })
})

describe('isClosedOnTime', () => {
  function row(over: Partial<IncidentActionRow>): IncidentActionRow {
    return {
      id: 'a', tenant_id: 't', incident_id: 'i',
      action_type: 'corrective', hierarchy_of_controls: null,
      description: 'x', owner_user_id: null, due_at: null,
      status: 'open', completed_at: null, verified_at: null, verified_by: null,
      verification_evidence: null, source_rca_node_id: null, cancel_reason: null,
      created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
      created_by: null, updated_by: null,
      ...over,
    }
  }

  it('returns false for open actions', () => {
    expect(isClosedOnTime(row({ status: 'open' }))).toBe(false)
  })

  it('returns true for completed-on-time', () => {
    expect(isClosedOnTime(row({
      status: 'complete',
      completed_at: '2026-04-05T00:00:00Z',
      due_at:       '2026-04-10T00:00:00Z',
    }))).toBe(true)
  })

  it('returns false for completed-late', () => {
    expect(isClosedOnTime(row({
      status: 'complete',
      completed_at: '2026-04-15T00:00:00Z',
      due_at:       '2026-04-10T00:00:00Z',
    }))).toBe(false)
  })

  it('returns true for completed without a deadline', () => {
    expect(isClosedOnTime(row({
      status: 'complete',
      completed_at: '2026-04-15T00:00:00Z',
      due_at:       null,
    }))).toBe(true)
  })

  it('counts verified as closed', () => {
    expect(isClosedOnTime(row({
      status: 'verified',
      completed_at: '2026-04-05T00:00:00Z',
      due_at:       '2026-04-10T00:00:00Z',
    }))).toBe(true)
  })
})

describe('daysUntilDue', () => {
  it('returns null when no due_at', () => {
    expect(daysUntilDue({ due_at: null })).toBeNull()
  })

  it('returns positive when due is in the future', () => {
    const due  = new Date('2026-04-10T00:00:00Z').toISOString()
    const now  = new Date('2026-04-01T00:00:00Z')
    expect(daysUntilDue({ due_at: due }, now)).toBe(9)
  })

  it('returns negative when overdue', () => {
    const due  = new Date('2026-04-01T00:00:00Z').toISOString()
    const now  = new Date('2026-04-04T00:00:00Z')
    expect(daysUntilDue({ due_at: due }, now)).toBe(-3)
  })
})
