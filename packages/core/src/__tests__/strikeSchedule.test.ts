import { describe, expect, it } from 'vitest'
import {
  addMonthsClamped,
  assignmentStanding,
  curriculumSchedule,
  expiryFor,
  isAssignmentReleased,
  nextDueDate,
  parseRecurrenceRule,
  serializeRecurrenceRule,
  strikeReminderFor,
} from '../strikeSchedule'

const d = (iso: string) => new Date(iso)

describe('parseRecurrenceRule', () => {
  it('reads calendar frequencies', () => {
    expect(parseRecurrenceRule({ freq: 'quarterly', expiry_days: 14 })).toEqual({ freq: 'quarterly', intervalDays: null, expiryDays: 14 })
  })

  it('keeps pre-existing interval-only rules working', () => {
    expect(parseRecurrenceRule({ interval_days: 30 })).toEqual({ freq: 'interval', intervalDays: 30, expiryDays: null })
  })

  it('rejects unusable rules', () => {
    expect(parseRecurrenceRule(null)).toBeNull()
    expect(parseRecurrenceRule({ freq: 'interval' })).toBeNull()
    expect(parseRecurrenceRule({ freq: 'weekly-ish' })).toBeNull()
    expect(parseRecurrenceRule({ interval_days: -3 })).toBeNull()
  })

  it('round-trips through serialize', () => {
    const rule = parseRecurrenceRule({ freq: 'interval', interval_days: 45, expiry_days: 7 })!
    expect(parseRecurrenceRule(serializeRecurrenceRule(rule))).toEqual(rule)
  })
})

describe('nextDueDate', () => {
  const quarterly = parseRecurrenceRule({ freq: 'quarterly' })!

  it('keeps the schedule anchored to the previous due date', () => {
    expect(nextDueDate(quarterly, d('2026-01-15T14:00:00Z'), d('2026-01-16T00:00:00Z')).toISOString()).toBe('2026-04-15T14:00:00.000Z')
  })

  it('skips missed periods when the cron catches up late, without drifting', () => {
    expect(nextDueDate(quarterly, d('2026-01-15T14:00:00Z'), d('2026-08-01T00:00:00Z')).toISOString()).toBe('2026-10-15T14:00:00.000Z')
  })

  it('clamps month-end anchors to short months', () => {
    expect(addMonthsClamped(d('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z')
    expect(addMonthsClamped(d('2028-01-31T00:00:00Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z')
    expect(nextDueDate(parseRecurrenceRule({ freq: 'monthly' })!, d('2026-01-31T00:00:00Z'), d('2026-02-01T00:00:00Z')).toISOString())
      .toBe('2026-02-28T00:00:00.000Z')
  })

  it('steps by days for interval rules and computes the expiry window', () => {
    const rule = parseRecurrenceRule({ interval_days: 10, expiry_days: 2 })!
    const due = nextDueDate(rule, d('2026-03-01T00:00:00Z'), d('2026-03-05T00:00:00Z'))
    expect(due.toISOString()).toBe('2026-03-11T00:00:00.000Z')
    expect(expiryFor(rule, due)?.toISOString()).toBe('2026-03-13T00:00:00.000Z')
  })
})

describe('curriculumSchedule', () => {
  it('releases modules in order on their offsets with a due window each', () => {
    const schedule = curriculumSchedule([
      { moduleId: 'confined-space', sortOrder: 2, releaseOffsetDays: 30, dueAfterDays: 14 },
      { moduleId: 'loto-101', sortOrder: 1, releaseOffsetDays: 0, dueAfterDays: 7 },
    ], d('2026-11-01T00:00:00Z'))
    expect(schedule.map(s => [s.moduleId, s.startsAt.toISOString().slice(0, 10), s.dueAt.toISOString().slice(0, 10)])).toEqual([
      ['loto-101', '2026-11-01', '2026-11-08'],
      ['confined-space', '2026-12-01', '2026-12-15'],
    ])
  })
})

describe('release and standing', () => {
  const now = d('2026-11-10T12:00:00Z')

  it('hides an assignment until its release date', () => {
    expect(isAssignmentReleased('2026-11-11T00:00:00Z', now)).toBe(false)
    expect(isAssignmentReleased(null, now)).toBe(true)
  })

  it('classifies upcoming, open, due soon, overdue and complete', () => {
    expect(assignmentStanding({ startsAt: '2026-12-01T00:00:00Z', dueAt: null, completed: false }, now)).toBe('upcoming')
    expect(assignmentStanding({ dueAt: '2026-12-01T00:00:00Z', completed: false }, now)).toBe('open')
    expect(assignmentStanding({ dueAt: '2026-11-12T00:00:00Z', completed: false }, now)).toBe('due_soon')
    expect(assignmentStanding({ dueAt: '2026-11-09T00:00:00Z', completed: false }, now)).toBe('overdue')
    expect(assignmentStanding({ dueAt: '2026-11-09T00:00:00Z', completed: true }, now)).toBe('complete')
  })
})

describe('strikeReminderFor', () => {
  const due = '2026-11-20T17:00:00Z'
  const at = (iso: string) => strikeReminderFor(due, new Date(iso))

  it('nudges three days and one day before the due date only', () => {
    expect(at('2026-11-17T18:00:00Z')).toBe('due_soon')
    expect(at('2026-11-18T18:00:00Z')).toBeNull()
    expect(at('2026-11-19T18:00:00Z')).toBe('due_soon')
    expect(at('2026-11-10T18:00:00Z')).toBeNull()
  })

  it('reminds the day after and then weekly while overdue', () => {
    expect(at('2026-11-21T18:00:00Z')).toBe('overdue')
    expect(at('2026-11-22T18:00:00Z')).toBeNull()
    expect(at('2026-11-28T18:00:00Z')).toBe('overdue')
  })

  it('ignores assignments without a due date', () => {
    expect(strikeReminderFor(null, new Date())).toBeNull()
  })
})
