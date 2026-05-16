import { describe, it, expect } from 'vitest'
import {
  classifyPeriodic,
  computeNextDueAt,
  groupByPeriodic,
  PERIODIC_REVIEW_WINDOW_DAYS,
  type PeriodicEquipmentSnapshot,
} from '@soteria/core/lotoPeriodicInspection'

const ASOF = new Date('2026-05-15T00:00:00Z')

function eq(p: Partial<PeriodicEquipmentSnapshot> & Pick<PeriodicEquipmentSnapshot, 'equipment_id'>): PeriodicEquipmentSnapshot {
  return {
    description:                  'Test',
    department:                   'Packaging',
    next_periodic_review_due_at:  null,
    decommissioned:               false,
    ...p,
  }
}

describe('classifyPeriodic', () => {
  it('returns "never" when due is null', () => {
    expect(classifyPeriodic(null, ASOF)).toBe('never')
  })

  it('returns "never" when due is unparseable (defensive)', () => {
    expect(classifyPeriodic('not-a-date', ASOF)).toBe('never')
  })

  it('returns "overdue" for a date in the past', () => {
    expect(classifyPeriodic('2025-01-01T00:00:00Z', ASOF)).toBe('overdue')
  })

  it('returns "due_soon" within the 30-day warning window', () => {
    // 14 days from ASOF
    expect(classifyPeriodic('2026-05-29T00:00:00Z', ASOF)).toBe('due_soon')
  })

  it('returns "due_soon" on the exact 30-day boundary', () => {
    expect(classifyPeriodic('2026-06-14T00:00:00Z', ASOF)).toBe('due_soon')
  })

  it('returns "current" outside the warning window', () => {
    expect(classifyPeriodic('2026-08-01T00:00:00Z', ASOF)).toBe('current')
  })

  it('treats "today" as still due_soon, not overdue', () => {
    // The standard talks about an annual cadence — inspection today
    // is exactly on the boundary. Bias toward "due soon" so the admin
    // can still record the inspection without it showing red.
    expect(classifyPeriodic('2026-05-15T00:00:00Z', ASOF)).toBe('due_soon')
  })
})

describe('groupByPeriodic', () => {
  it('drops decommissioned equipment from every cohort', () => {
    const groups = groupByPeriodic([
      eq({ equipment_id: 'EQ-1', decommissioned: true }),
      eq({ equipment_id: 'EQ-2' }),
    ], ASOF)
    const flat = groups.flatMap(g => g.items)
    expect(flat.map(i => i.equipment_id)).toEqual(['EQ-2'])
  })

  it('groups by status and sorts each cohort by due date ascending', () => {
    const groups = groupByPeriodic([
      eq({ equipment_id: 'EQ-CUR',   next_periodic_review_due_at: '2026-12-15T00:00:00Z' }),
      eq({ equipment_id: 'EQ-OVD-A', next_periodic_review_due_at: '2026-03-01T00:00:00Z' }),
      eq({ equipment_id: 'EQ-DUE',   next_periodic_review_due_at: '2026-05-29T00:00:00Z' }),
      eq({ equipment_id: 'EQ-NEV',   next_periodic_review_due_at: null }),
      eq({ equipment_id: 'EQ-OVD-B', next_periodic_review_due_at: '2025-12-01T00:00:00Z' }),
    ], ASOF)

    expect(groups[0]).toEqual({
      status: 'overdue',
      items: [
        expect.objectContaining({ equipment_id: 'EQ-OVD-B' }),
        expect.objectContaining({ equipment_id: 'EQ-OVD-A' }),
      ],
    })
    expect(groups[1]).toEqual({
      status: 'due_soon',
      items: [expect.objectContaining({ equipment_id: 'EQ-DUE' })],
    })
    expect(groups[2]).toEqual({
      status: 'never',
      items: [expect.objectContaining({ equipment_id: 'EQ-NEV' })],
    })
    expect(groups[3]).toEqual({
      status: 'current',
      items: [expect.objectContaining({ equipment_id: 'EQ-CUR' })],
    })
  })

  it('produces the four cohorts in admin-display order (overdue first)', () => {
    const groups = groupByPeriodic([], ASOF)
    expect(groups.map(g => g.status)).toEqual(['overdue', 'due_soon', 'never', 'current'])
  })
})

describe('computeNextDueAt', () => {
  it('adds exactly 365 days to the inspection timestamp', () => {
    const inspected = new Date('2026-05-15T00:00:00Z')
    const next = computeNextDueAt(inspected)
    const diffDays = (next.getTime() - inspected.getTime()) / (24 * 60 * 60 * 1000)
    expect(diffDays).toBe(PERIODIC_REVIEW_WINDOW_DAYS)
  })

  it('preserves the time-of-day component', () => {
    const inspected = new Date('2026-05-15T14:30:00Z')
    const next = computeNextDueAt(inspected)
    expect(next.getUTCHours()).toBe(14)
    expect(next.getUTCMinutes()).toBe(30)
  })
})
