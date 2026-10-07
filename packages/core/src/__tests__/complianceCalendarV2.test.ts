import { describe, it, expect } from 'vitest'
import {
  advanceDueDate, buildMonthGrid, reminderDue, buildComplianceDigest, REMINDER_INTERVAL_DAYS,
} from '../complianceCalendar'

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe('advanceDueDate — clampToMonthEnd', () => {
  const clamp = { clampToMonthEnd: true }

  it('keeps a quarterly month-end deadline on month ends (the drift the plain version has)', () => {
    // Plain: Mar 31 + 3 months overflows to Jul 1, then Oct 1: it has left the period end.
    expect(advanceDueDate('2026-03-31', 'quarterly')).toBe('2026-07-01')
    let due = '2026-03-31'
    const seen: string[] = []
    for (let i = 0; i < 5; i++) { due = advanceDueDate(due, 'quarterly', null, clamp); seen.push(due) }
    expect(seen).toEqual(['2026-06-30', '2026-09-30', '2026-12-31', '2027-03-31', '2027-06-30'])
  })

  it('keeps a monthly month-end deadline on month ends through February and a leap year', () => {
    let due = '2027-01-31'
    const seen: string[] = []
    for (let i = 0; i < 3; i++) { due = advanceDueDate(due, 'monthly', null, clamp); seen.push(due) }
    expect(seen).toEqual(['2027-02-28', '2027-03-31', '2027-04-30'])
    expect(advanceDueDate('2028-01-31', 'monthly', null, clamp)).toBe('2028-02-29')
  })

  it('clamps a day that does not exist in the target month without treating it as a month end', () => {
    expect(advanceDueDate('2026-01-30', 'monthly', null, clamp)).toBe('2026-02-28')
    // Day 30 is not a month end in January, so it is not promoted to the end of March.
    expect(advanceDueDate('2026-01-30', 'quarterly', null, clamp)).toBe('2026-04-30')
    expect(advanceDueDate('2026-01-29', 'quarterly', null, clamp)).toBe('2026-04-29')
  })

  it('moves a Feb 29 deadline to Feb 28 in a non-leap year, and a month-end Feb 28 to Feb 29 in a leap year', () => {
    expect(advanceDueDate('2028-02-29', 'annual', null, clamp)).toBe('2029-02-28')
    expect(advanceDueDate('2027-02-28', 'annual', null, clamp)).toBe('2028-02-29')
  })

  it('handles semiannual, biennial and year rollover', () => {
    expect(advanceDueDate('2026-12-31', 'semiannual', null, clamp)).toBe('2027-06-30')
    expect(advanceDueDate('2026-06-30', 'semiannual', null, clamp)).toBe('2026-12-31')
    expect(advanceDueDate('2026-03-15', 'biennial', null, clamp)).toBe('2028-03-15')
  })

  it('leaves once and custom_days alone', () => {
    expect(advanceDueDate('2026-03-31', 'once', null, clamp)).toBe('2026-03-31')
    expect(advanceDueDate('2026-03-31', 'custom_days', 10, clamp)).toBe('2026-04-10')
  })

  it('does not change the existing behaviour when the option is off', () => {
    expect(advanceDueDate('2026-01-31', 'monthly')).toBe('2026-03-03')
    expect(advanceDueDate('2026-03-15', 'quarterly')).toBe('2026-06-15')
  })
})

describe('buildMonthGrid', () => {
  it('is whole weeks of seven, Sunday first, padded with the neighbouring months', () => {
    const grid = buildMonthGrid(2026, 10, [])
    expect(grid.every(week => week.length === 7)).toBe(true)
    expect(grid).toHaveLength(5) // Oct 2026 starts on a Thursday: 4 padding days + 31 days = 35
    expect(grid[0]![0]!.date).toBe('2026-09-27')
    expect(grid[0]![4]).toMatchObject({ date: '2026-10-01', inMonth: true })
    expect(grid[0]![0]!.inMonth).toBe(false)
    expect(grid[4]![6]!.date).toBe('2026-10-31')
  })

  it('uses six rows when a month needs them, and four when February fits exactly', () => {
    expect(buildMonthGrid(2026, 8, [])).toHaveLength(6)  // Aug 2026 starts on a Saturday
    expect(buildMonthGrid(2026, 2, [])).toHaveLength(4)  // Feb 2026: starts Sunday, 28 days
  })

  it('places items on their due date and ignores ones outside the visible weeks', () => {
    const items = [
      { id: 'a', dueDate: '2026-10-15' }, { id: 'b', dueDate: '2026-10-15' },
      { id: 'c', dueDate: '2026-12-25' },
    ]
    const days = buildMonthGrid(2026, 10, items).flat()
    expect(days.find(d => d.date === '2026-10-15')!.items.map(i => i.id)).toEqual(['a', 'b'])
    expect(days.flatMap(d => d.items).map(i => i.id)).toEqual(['a', 'b'])
  })

  it('shows a deadline that falls in the padding days of the neighbouring month', () => {
    const days = buildMonthGrid(2026, 10, [{ id: 'x', dueDate: '2026-09-28' }]).flat()
    expect(days.find(d => d.date === '2026-09-28')).toMatchObject({ inMonth: false, items: [{ id: 'x' }] })
  })

  it('covers December into January', () => {
    const grid = buildMonthGrid(2026, 12, [])
    expect(grid.flat().some(d => d.date.startsWith('2027-01'))).toBe(true)
  })
})

describe('reminderDue', () => {
  const base = { status: 'open', nextDueAt: '2026-10-20', leadDays: 14, lastRemindedOn: null as string | null }

  it('does not remind before the lead window', () => {
    expect(reminderDue(base, at('2026-10-05'))).toBe(false)
  })

  it('reminds once the lead window opens, and on the due date', () => {
    expect(reminderDue(base, at('2026-10-06'))).toBe(true)
    expect(reminderDue(base, at('2026-10-20'))).toBe(true)
  })

  it('keeps reminding an overdue item, weekly rather than once and then silence', () => {
    expect(reminderDue(base, at('2026-11-15'))).toBe(true)
    expect(reminderDue({ ...base, lastRemindedOn: '2026-11-10' }, at('2026-11-15'))).toBe(false)
    expect(reminderDue({ ...base, lastRemindedOn: '2026-11-08' }, at('2026-11-15'))).toBe(true)
  })

  it('never reminds more often than weekly', () => {
    const lastSent = '2026-10-10'
    expect(reminderDue({ ...base, lastRemindedOn: lastSent }, at('2026-10-16'))).toBe(false)
    expect(reminderDue({ ...base, lastRemindedOn: lastSent }, at('2026-10-17'))).toBe(true)
    expect(REMINDER_INTERVAL_DAYS).toBe(7)
  })

  it('does not remind about completed or dismissed items', () => {
    for (const status of ['completed', 'dismissed']) expect(reminderDue({ ...base, status }, at('2026-11-15'))).toBe(false)
  })

  it('honours each obligation\'s own lead time', () => {
    expect(reminderDue({ ...base, leadDays: 0 }, at('2026-10-19'))).toBe(false)
    expect(reminderDue({ ...base, leadDays: 0 }, at('2026-10-20'))).toBe(true)
    expect(reminderDue({ ...base, leadDays: 60 }, at('2026-09-01'))).toBe(true)
  })
})

describe('buildComplianceDigest', () => {
  const rows = [
    { title: 'late-3', nextDueAt: '2026-10-04', leadDays: 30, status: 'open' },
    { title: 'late-10', nextDueAt: '2026-09-27', leadDays: 30, status: 'open' },
    { title: 'soon-2', nextDueAt: '2026-10-09', leadDays: 30, status: 'open' },
    { title: 'soon-20', nextDueAt: '2026-10-27', leadDays: 30, status: 'open' },
    { title: 'far', nextDueAt: '2027-03-01', leadDays: 30, status: 'open' },
    { title: 'done', nextDueAt: '2026-09-01', leadDays: 30, status: 'completed' },
  ]

  it('splits overdue from due-soon and leaves out the far-off and the closed', () => {
    const d = buildComplianceDigest(rows, at('2026-10-07'))
    expect(d.overdue.map(r => r.title)).toEqual(['late-10', 'late-3'])
    expect(d.dueSoon.map(r => r.title)).toEqual(['soon-2', 'soon-20'])
  })

  it('reports how late and how soon', () => {
    const d = buildComplianceDigest(rows, at('2026-10-07'))
    expect(d.overdue.map(r => r.daysOverdue)).toEqual([10, 3])
    expect(d.dueSoon.map(r => r.daysUntil)).toEqual([2, 20])
  })

  it('is empty when nothing is pressing', () => {
    expect(buildComplianceDigest([], at('2026-10-07'))).toEqual({ overdue: [], dueSoon: [] })
  })
})
