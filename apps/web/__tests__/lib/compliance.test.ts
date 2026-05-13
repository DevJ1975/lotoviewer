import { describe, it, expect } from 'vitest'
import {
  deriveObligationStatus,
  advanceNextDueDate,
  addDays,
  addMonths,
  toDateString,
  todayUTC,
} from '@soteria/core/compliance'

// Pure-function suite for the compliance domain. These power the
// derived status pill on every obligation row, so subtle off-by-one
// errors here ripple into every dashboard view.

describe('deriveObligationStatus', () => {
  const base = {
    frequency:       'annual' as const,
    leadDays:        14,
    lastCompletedAt: null,
    snoozedUntil:    null,
    notApplicable:   false,
  }

  it('returns not_applicable when flagged, regardless of dates', () => {
    const s = deriveObligationStatus(
      { ...base, nextDueDate: '2020-01-01', notApplicable: true },
      '2026-05-13',
    )
    expect(s).toBe('not_applicable')
  })

  it('treats one_time + last_completed as completed', () => {
    const s = deriveObligationStatus(
      { ...base, frequency: 'one_time', nextDueDate: '2026-01-01', lastCompletedAt: '2026-01-05T10:00:00Z' },
      '2026-05-13',
    )
    expect(s).toBe('completed')
  })

  it('honors snoozed_until until it expires', () => {
    expect(deriveObligationStatus({ ...base, nextDueDate: '2026-04-01', snoozedUntil: '2026-06-01' }, '2026-05-13')).toBe('snoozed')
    // Snooze expired → falls through to overdue/upcoming derivation.
    expect(deriveObligationStatus({ ...base, nextDueDate: '2026-04-01', snoozedUntil: '2026-05-01' }, '2026-05-13')).toBe('overdue')
  })

  it('flags overdue strictly when next_due < today', () => {
    expect(deriveObligationStatus({ ...base, nextDueDate: '2026-05-12' }, '2026-05-13')).toBe('overdue')
    // Equal date is NOT overdue; it's due_soon (within 14-day lead window).
    expect(deriveObligationStatus({ ...base, nextDueDate: '2026-05-13' }, '2026-05-13')).toBe('due_soon')
  })

  it('flags due_soon when within the lead window inclusive', () => {
    expect(deriveObligationStatus({ ...base, nextDueDate: '2026-05-27' }, '2026-05-13')).toBe('due_soon')
    // 15 days out → just past the lead window → upcoming.
    expect(deriveObligationStatus({ ...base, nextDueDate: '2026-05-28' }, '2026-05-13')).toBe('upcoming')
  })

  it('zero lead_days → due_soon only on the exact due date', () => {
    expect(deriveObligationStatus({ ...base, leadDays: 0, nextDueDate: '2026-05-13' }, '2026-05-13')).toBe('due_soon')
    expect(deriveObligationStatus({ ...base, leadDays: 0, nextDueDate: '2026-05-14' }, '2026-05-13')).toBe('upcoming')
  })
})

describe('advanceNextDueDate', () => {
  it('returns null for one_time (caller stops advancing)', () => {
    expect(advanceNextDueDate('one_time', '2026-05-13T12:00:00Z', null)).toBeNull()
  })

  it('advances calendar cadences off the completion date', () => {
    expect(advanceNextDueDate('daily',      '2026-05-13T00:00:00Z', null)).toBe('2026-05-14')
    expect(advanceNextDueDate('weekly',     '2026-05-13T00:00:00Z', null)).toBe('2026-05-20')
    expect(advanceNextDueDate('annual',     '2026-05-13T00:00:00Z', null)).toBe('2027-05-13')
    expect(advanceNextDueDate('biennial',   '2026-05-13T00:00:00Z', null)).toBe('2028-05-12') // 730 days
  })

  it('monthly uses real calendar-month math with day clamping', () => {
    expect(advanceNextDueDate('monthly', '2026-01-31T00:00:00Z', null)).toBe('2026-02-28')
    expect(advanceNextDueDate('monthly', '2024-01-31T00:00:00Z', null)).toBe('2024-02-29') // leap year
    expect(advanceNextDueDate('monthly', '2026-05-15T00:00:00Z', null)).toBe('2026-06-15')
  })

  it('custom_days respects frequency_days, falls back to 30 if missing', () => {
    expect(advanceNextDueDate('custom_days', '2026-05-13T00:00:00Z', 90)).toBe('2026-08-11')
    expect(advanceNextDueDate('custom_days', '2026-05-13T00:00:00Z', null)).toBe('2026-06-12')
  })
})

describe('date helpers', () => {
  it('toDateString slices a full ISO timestamp to YYYY-MM-DD in UTC', () => {
    expect(toDateString('2026-05-13T23:30:00Z')).toBe('2026-05-13')
    expect(toDateString('2026-05-13')).toBe('2026-05-13')
  })

  it('toDateString throws on garbage', () => {
    expect(() => toDateString('not-a-date')).toThrow()
  })

  it('addDays handles positive and negative deltas without DST drift', () => {
    expect(addDays('2026-05-13', 1)).toBe('2026-05-14')
    expect(addDays('2026-05-13', -1)).toBe('2026-05-12')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('addMonths clamps to month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29') // leap year
  })

  it('todayUTC returns YYYY-MM-DD from supplied Date', () => {
    expect(todayUTC(new Date('2026-05-13T23:59:59Z'))).toBe('2026-05-13')
    // Boundary check: late-evening UTC date stays today, not tomorrow.
    expect(todayUTC(new Date('2026-05-13T00:00:00Z'))).toBe('2026-05-13')
  })
})
