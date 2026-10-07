import { describe, it, expect } from 'vitest'
import type { Deadline } from '@/lib/environmental/client'
import {
  buildDeadlineMonth, bucketOf, cadenceLabel, canCompleteDeadline, checklistHref, checklistKeysFor, chipsForDay,
  completionMessage, filterDeadlines, formatDate, formatLocalDate, groupByUrgency, isoDay, localToday, monthOf, monthTitle,
  orderByUrgency, originOf, ownerLabel, programLabel, relativeDueText, shiftMonth, siteLabel, wholeNumberOrNull,
} from '@/lib/environmental/calendarView'

// Wednesday, Oct 7 2026. Every date below is relative to this fixed day.
const NOW = new Date(Date.UTC(2026, 9, 7))

function deadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 'd1', title: 'Quarterly inspection', description: null, regulatory_ref: null, program: 'stormwater',
    cadence: 'quarterly', cadence_days: null, next_due_at: '2026-10-20', status: 'open', lead_days: 14,
    due_anchor: 'fixed', owner_user_id: null, facility_id: 'f1', source: 'library', checklist_template_id: null,
    library_key: null, urgency: null, days_until: null, last_completed_at: null,
    ...overrides,
  }
}

describe('localToday', () => {
  it('keeps the wall-clock date at any hour, which UTC would not for an evening viewer', () => {
    expect(isoDay(localToday(new Date(2026, 9, 7, 23, 59)))).toBe('2026-10-07')
    expect(isoDay(localToday(new Date(2026, 9, 7, 0, 1)))).toBe('2026-10-07')
  })

  it('is midnight UTC, so the core day counts are whole days', () => {
    expect(localToday(new Date(2026, 11, 31, 18, 30)).toISOString()).toBe('2026-12-31T00:00:00.000Z')
  })
})

describe('formatDate', () => {
  it('writes a date the same way in every time zone', () => {
    expect(formatDate('2026-10-07')).toBe('Oct 7, 2026')
    expect(formatDate('2027-01-01')).toBe('Jan 1, 2027')
  })

  it('uses the date part of a timestamp', () => {
    expect(formatDate('2026-03-02T23:30:00+00:00')).toBe('Mar 2, 2026')
  })
})

describe('formatLocalDate', () => {
  it('names the date the viewer lived the moment on, in the evening as well as the morning', () => {
    expect(formatLocalDate(new Date(2026, 6, 1, 18, 30).toISOString())).toBe('Jul 1, 2026')
    expect(formatLocalDate(new Date(2026, 6, 1, 0, 5).toISOString())).toBe('Jul 1, 2026')
    expect(formatLocalDate(new Date(2026, 11, 31, 23, 59).toISOString())).toBe('Dec 31, 2026')
  })
})

describe('relativeDueText', () => {
  it.each([
    ['2026-10-07', 'today'],
    ['2026-10-08', 'in 1 day'],
    ['2026-10-19', 'in 12 days'],
    ['2026-10-06', '1 day overdue'],
    ['2026-10-04', '3 days overdue'],
  ])('%s reads "%s"', (due, expected) => {
    expect(relativeDueText(due, NOW)).toBe(expected)
  })

  it('counts across a month end and a leap day', () => {
    expect(relativeDueText('2026-11-02', NOW)).toBe('in 26 days')
    expect(relativeDueText('2028-02-29', new Date(Date.UTC(2028, 1, 27)))).toBe('in 2 days')
    expect(relativeDueText('2028-03-01', new Date(Date.UTC(2028, 1, 27)))).toBe('in 3 days')
  })
})

describe('cadenceLabel', () => {
  it('words the known cadences and the custom day count', () => {
    expect(cadenceLabel('quarterly', null)).toBe('Quarterly')
    expect(cadenceLabel('custom_days', 45)).toBe('Every 45 days')
    expect(cadenceLabel('custom_days', 1)).toBe('Every 1 day')
  })

  it('falls back to the stored value for a cadence it does not know, rather than hiding it', () => {
    expect(cadenceLabel('fortnightly', null)).toBe('fortnightly')
    expect(cadenceLabel('toString', null)).toBe('toString')
  })
})

describe('programLabel', () => {
  it('uses the program\'s display name, and shows an unknown program as stored rather than hiding it', () => {
    expect(programLabel('hazardous_waste')).toBe('Hazardous waste')
    expect(programLabel('noise')).toBe('noise')
    expect(programLabel(null)).toBeNull()
  })
})

describe('wholeNumberOrNull', () => {
  it.each([['30', 30], [' 7 ', 7], ['0', 0], ['-1', -1]])('reads %j as %s', (text, expected) => {
    expect(wholeNumberOrNull(text)).toBe(expected)
  })

  it.each([[''], ['  '], ['3.5'], ['abc'], ['1e3'], ['12 days']])('refuses %j instead of inventing a number', text => {
    expect(wholeNumberOrNull(text)).toBeNull()
  })
})

describe('completionMessage', () => {
  it('names the next due date when the deadline repeats', () => {
    expect(completionMessage({ title: 'Tier II report', status: 'open', next_due_at: '2027-03-01' }))
      .toBe('Tier II report: marked complete. Next due Mar 1, 2027.')
  })

  it('does not promise a next date for a deadline that was one time only', () => {
    expect(completionMessage({ title: 'Consent decree report', status: 'completed', next_due_at: '2026-10-31' }))
      .toBe('Consent decree report: marked complete.')
  })
})

describe('bucketOf', () => {
  it('is overdue the day after the due date and due soon on it, whatever the reminder window', () => {
    expect(bucketOf(deadline({ next_due_at: '2026-10-06' }), NOW)).toBe('overdue')
    expect(bucketOf(deadline({ next_due_at: '2026-10-07', lead_days: 0 }), NOW)).toBe('due_soon')
  })

  it('is due soon through the last day of the reminder window and upcoming after it', () => {
    expect(bucketOf(deadline({ next_due_at: '2026-10-21', lead_days: 14 }), NOW)).toBe('due_soon')
    expect(bucketOf(deadline({ next_due_at: '2026-10-22', lead_days: 14 }), NOW)).toBe('upcoming')
  })

  it('puts a deadline that is no longer open in its own bucket, even if its date is past', () => {
    expect(bucketOf(deadline({ status: 'completed', next_due_at: '2026-01-01' }), NOW)).toBe('completed')
    expect(bucketOf(deadline({ status: 'dismissed', next_due_at: '2026-01-01' }), NOW)).toBe('dismissed')
  })
})

describe('groupByUrgency', () => {
  const rows = [
    deadline({ id: 'up', title: 'Upcoming one', next_due_at: '2027-01-15' }),
    deadline({ id: 'late', title: 'Late one', next_due_at: '2026-09-30' }),
    deadline({ id: 'soon-b', title: 'B soon', next_due_at: '2026-10-12' }),
    deadline({ id: 'soon-a', title: 'A soon', next_due_at: '2026-10-12' }),
    deadline({ id: 'earlier', title: 'Earlier soon', next_due_at: '2026-10-09' }),
    deadline({ id: 'done', title: 'Done', status: 'completed', next_due_at: '2026-06-01' }),
  ]

  it('orders the groups overdue, due soon, upcoming, then the closed ones', () => {
    expect(groupByUrgency(rows, NOW).map(g => [g.bucket, g.label])).toEqual([
      ['overdue', 'Overdue'], ['due_soon', 'Due soon'], ['upcoming', 'Upcoming'], ['completed', 'Completed'],
    ])
  })

  it('orders each group by due date, then title', () => {
    const soon = groupByUrgency(rows, NOW).find(g => g.bucket === 'due_soon')!
    expect(soon.deadlines.map(d => d.id)).toEqual(['earlier', 'soon-a', 'soon-b'])
  })

  it('leaves empty groups out and returns nothing for nothing', () => {
    expect(groupByUrgency([deadline({ next_due_at: '2026-09-01' })], NOW).map(g => g.bucket)).toEqual(['overdue'])
    expect(groupByUrgency([], NOW)).toEqual([])
  })

  it('does not reorder the rows it was given', () => {
    const before = rows.map(r => r.id)
    groupByUrgency(rows, NOW)
    expect(rows.map(r => r.id)).toEqual(before)
  })
})

describe('filterDeadlines', () => {
  const rows = [
    deadline({ id: 'a', title: 'Stormwater annual report', regulatory_ref: '40 CFR 122.26', owner_user_id: 'u1' }),
    deadline({ id: 'b', title: 'Renew air permit', regulatory_ref: 'SCAQMD Rule 203', owner_user_id: 'u2' }),
    deadline({ id: 'c', title: 'Oil storage review', regulatory_ref: null, owner_user_id: null }),
  ]
  const nobody = { search: '', assignedToUserId: null }

  it('returns everything when nothing is asked for', () => {
    expect(filterDeadlines(rows, nobody).map(d => d.id)).toEqual(['a', 'b', 'c'])
    expect(filterDeadlines(rows, { ...nobody, search: '   ' }).map(d => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('searches the title without regard to case', () => {
    expect(filterDeadlines(rows, { ...nobody, search: 'AIR PERMIT' }).map(d => d.id)).toEqual(['b'])
  })

  it('searches the regulatory reference too', () => {
    expect(filterDeadlines(rows, { ...nobody, search: 'cfr 122' }).map(d => d.id)).toEqual(['a'])
    expect(filterDeadlines(rows, { ...nobody, search: 'scaqmd' }).map(d => d.id)).toEqual(['b'])
  })

  it('needs every word, in any order, to match', () => {
    expect(filterDeadlines(rows, { ...nobody, search: 'report stormwater' }).map(d => d.id)).toEqual(['a'])
    expect(filterDeadlines(rows, { ...nobody, search: 'report permit' })).toEqual([])
  })

  it('does not find a deadline by a reference it does not have', () => {
    expect(filterDeadlines(rows, { ...nobody, search: 'null' })).toEqual([])
  })

  it('keeps only the deadlines assigned to the given person, never the unassigned', () => {
    expect(filterDeadlines(rows, { ...nobody, assignedToUserId: 'u2' }).map(d => d.id)).toEqual(['b'])
  })

  it('applies the person and the search together', () => {
    expect(filterDeadlines(rows, { search: 'renew', assignedToUserId: 'u1' })).toEqual([])
  })
})

describe('months', () => {
  it('reads the month of a date', () => {
    expect(monthOf('2026-10-07')).toEqual({ year: 2026, month: 10 })
    expect(monthOf('2027-01-31T08:00:00Z')).toEqual({ year: 2027, month: 1 })
  })

  it('steps across a year boundary in both directions', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth({ year: 2026, month: 10 }, 0)).toEqual({ year: 2026, month: 10 })
    expect(shiftMonth({ year: 2026, month: 3 }, -15)).toEqual({ year: 2024, month: 12 })
    expect(shiftMonth({ year: 2026, month: 3 }, 24)).toEqual({ year: 2028, month: 3 })
  })

  it('titles a month', () => {
    expect(monthTitle({ year: 2026, month: 10 })).toBe('October 2026')
    expect(monthTitle({ year: 2028, month: 2 })).toBe('February 2028')
  })
})

describe('buildDeadlineMonth', () => {
  const dates = (weeks: ReturnType<typeof buildDeadlineMonth>) => weeks.flat().map(d => d.date)

  it('lays October 2026 out as five Sunday-first weeks padded with its neighbours', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 10 }, [])
    expect(weeks).toHaveLength(5)
    expect(weeks.every(week => week.length === 7)).toBe(true)
    expect(weeks[0]![0]).toMatchObject({ date: '2026-09-27', inMonth: false })
    expect(weeks[0]![4]).toMatchObject({ date: '2026-10-01', inMonth: true })
    expect(weeks[4]![6]).toMatchObject({ date: '2026-10-31', inMonth: true })
  })

  it('has exactly four weeks when February starts on a Sunday and has 28 days', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 2 }, [])
    expect(weeks).toHaveLength(4)
    expect(weeks[0]![0]).toMatchObject({ date: '2026-02-01', inMonth: true })
    expect(weeks[3]![6]).toMatchObject({ date: '2026-02-28', inMonth: true })
  })

  it('has six weeks when a 31-day month starts on a Saturday', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 8 }, [])
    expect(weeks).toHaveLength(6)
    expect(weeks[0]![6]).toMatchObject({ date: '2026-08-01', inMonth: true })
    expect(weeks[5]![0]).toMatchObject({ date: '2026-08-30', inMonth: true })
  })

  it('includes February 29 in a leap year and skips it in a common year', () => {
    expect(dates(buildDeadlineMonth({ year: 2028, month: 2 }, []))).toContain('2028-02-29')
    expect(dates(buildDeadlineMonth({ year: 2027, month: 2 }, []))).not.toContain('2027-02-29')
    expect(buildDeadlineMonth({ year: 2028, month: 2 }, []).flat().filter(d => d.inMonth)).toHaveLength(29)
  })

  it('rolls into the next year when December is padded with January days', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 12 }, [])
    expect(weeks[4]![6]).toMatchObject({ date: '2027-01-02', inMonth: false })
  })

  it('puts each deadline on its due date, several to a day', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 10 }, [
      deadline({ id: 'a', next_due_at: '2026-10-15' }),
      deadline({ id: 'b', next_due_at: '2026-10-15' }),
      deadline({ id: 'c', next_due_at: '2026-10-31' }),
    ])
    const byDate = new Map(weeks.flat().map(d => [d.date, d.deadlines.map(x => x.id)]))
    expect(byDate.get('2026-10-15')).toEqual(['a', 'b'])
    expect(byDate.get('2026-10-31')).toEqual(['c'])
    expect(byDate.get('2026-10-14')).toEqual([])
  })

  it('shows a neighbouring month\'s deadline on the padded day it falls on, and drops one outside the grid', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 10 }, [
      deadline({ id: 'sep', next_due_at: '2026-09-28' }),
      deadline({ id: 'far', next_due_at: '2026-12-01' }),
    ])
    expect(weeks[0]![1]).toMatchObject({ date: '2026-09-28', inMonth: false })
    expect(weeks[0]![1]!.deadlines.map(d => d.id)).toEqual(['sep'])
    expect(weeks.flat().some(d => d.deadlines.some(x => x.id === 'far'))).toBe(false)
  })

  it('places a deadline whose date arrives as a timestamp', () => {
    const weeks = buildDeadlineMonth({ year: 2026, month: 10 }, [deadline({ id: 't', next_due_at: '2026-10-20T00:00:00+00:00' })])
    expect(weeks.flat().find(d => d.date === '2026-10-20')!.deadlines.map(d => d.id)).toEqual(['t'])
  })
})

describe('chipsForDay', () => {
  // Due in 20 days: the reminder window alone decides whether an open one is due soon or upcoming.
  const onTheDay = (overrides: Partial<Deadline>) => deadline({ next_due_at: '2026-10-27', ...overrides })
  const mixed = [
    onTheDay({ id: 'dismissed', title: 'A', status: 'dismissed' }),
    onTheDay({ id: 'upcoming', title: 'B', lead_days: 7 }),
    onTheDay({ id: 'completed', title: 'C', status: 'completed' }),
    onTheDay({ id: 'soon', title: 'D', lead_days: 30 }),
  ]

  it('shows everything and no overflow up to the limit', () => {
    expect(chipsForDay([], NOW)).toEqual({ shown: [], overflow: 0 })
    const three = mixed.slice(0, 3)
    expect(chipsForDay(three, NOW).shown).toHaveLength(3)
    expect(chipsForDay(three, NOW).overflow).toBe(0)
  })

  it('shows three and counts the rest', () => {
    const five = Array.from({ length: 5 }, (_, i) => onTheDay({ id: `d${i}`, title: `Deadline ${i}` }))
    const chips = chipsForDay(five, NOW)
    expect(chips.shown.map(d => d.id)).toEqual(['d0', 'd1', 'd2'])
    expect(chips.overflow).toBe(2)
  })

  it('keeps the most pressing ones when it has to cut', () => {
    const chips = chipsForDay(mixed, NOW)
    expect(chips.shown.map(d => d.id)).toEqual(['soon', 'upcoming', 'completed'])
    expect(chips.overflow).toBe(1)
  })

  it('honours a different limit', () => {
    const chips = chipsForDay(mixed, NOW, 1)
    expect(chips.shown.map(d => d.id)).toEqual(['soon'])
    expect(chips.overflow).toBe(3)
  })
})

describe('orderByUrgency', () => {
  it('lists overdue before due soon before upcoming, then by title, without changing its input', () => {
    const rows = [
      deadline({ id: 'up', title: 'Z', next_due_at: '2027-02-01' }),
      deadline({ id: 'b', title: 'B', next_due_at: '2026-09-01' }),
      deadline({ id: 'a', title: 'A', next_due_at: '2026-09-01' }),
      deadline({ id: 'soon', title: 'M', next_due_at: '2026-10-10' }),
    ]
    expect(orderByUrgency(rows, NOW).map(d => d.id)).toEqual(['a', 'b', 'soon', 'up'])
    expect(rows.map(d => d.id)).toEqual(['up', 'b', 'a', 'soon'])
  })
})

describe('ownerLabel and siteLabel', () => {
  const people = new Map([['u1', 'Pat Rivera']])
  const sites = new Map([['f1', 'Plant A']])

  it('names a known owner, says "Assigned" for one it cannot resolve, and never shows an id', () => {
    expect(ownerLabel('u1', people)).toBe('Pat Rivera')
    expect(ownerLabel('9d2c0b3e-0000-4000-8000-000000000000', people)).toBe('Assigned')
    expect(ownerLabel(null, people)).toBe('Unassigned')
  })

  it('names a site, calls a null site "All sites", and does not show the id of one it does not know', () => {
    expect(siteLabel('f1', sites)).toBe('Plant A')
    expect(siteLabel(null, sites)).toBe('All sites')
    expect(siteLabel('f9', sites)).toBe('Another site')
  })
})

describe('originOf', () => {
  it('calls a library deadline Library, a tenant one Custom, and a permit renewal Permit renewal', () => {
    expect(originOf(deadline({ source: 'library', library_key: 'sw-fed-routine-inspection' }))).toBe('library')
    expect(originOf(deadline({ source: 'tenant', library_key: null }))).toBe('custom')
    expect(originOf(deadline({ source: 'library', library_key: 'permit-renewal:abc' }))).toBe('permit_renewal')
  })

  it('treats anything else as custom', () => {
    expect(originOf(deadline({ source: 'ai' }))).toBe('custom')
    expect(originOf(deadline({ source: 'system' }))).toBe('custom')
  })
})

describe('canCompleteDeadline', () => {
  const member = { canAdmin: false, userId: 'u1' }

  it('lets an admin complete any open deadline', () => {
    expect(canCompleteDeadline(deadline({ owner_user_id: 'u9' }), { canAdmin: true, userId: 'u1' })).toBe(true)
    expect(canCompleteDeadline(deadline({ owner_user_id: null }), { canAdmin: true, userId: null })).toBe(true)
  })

  it('lets the assigned owner complete it', () => {
    expect(canCompleteDeadline(deadline({ owner_user_id: 'u1' }), member)).toBe(true)
  })

  it('does not let another member, or an unassigned deadline\'s non-admin, complete it', () => {
    expect(canCompleteDeadline(deadline({ owner_user_id: 'u2' }), member)).toBe(false)
    expect(canCompleteDeadline(deadline({ owner_user_id: null }), member)).toBe(false)
    expect(canCompleteDeadline(deadline({ owner_user_id: null }), { canAdmin: false, userId: null })).toBe(false)
  })

  it('offers nothing on a deadline that is not open', () => {
    expect(canCompleteDeadline(deadline({ status: 'completed' }), { canAdmin: true, userId: 'u1' })).toBe(false)
    expect(canCompleteDeadline(deadline({ status: 'dismissed', owner_user_id: 'u1' }), member)).toBe(false)
  })
})

describe('checklists', () => {
  it('maps a library deadline to its checklist, and the state decides which library is read', () => {
    expect(checklistKeysFor(null).get('sw-fed-routine-inspection')).toBe('sw-routine-inspection')
    expect(checklistKeysFor('CA').get('sw-ca-mvo')).toBe('sw-ca-mvo')
    expect(checklistKeysFor('CA').has('sw-fed-routine-inspection')).toBe(false)
    expect(checklistKeysFor(null).has('sw-ca-mvo')).toBe(false)
  })

  it('reads a state without a pack as the federal baseline', () => {
    expect(checklistKeysFor('ZZ')).toEqual(checklistKeysFor(null))
  })

  it('has no entry for a deadline without a checklist', () => {
    expect(checklistKeysFor(null).has('sw-fed-swppp-review')).toBe(false)
  })

  const keys = checklistKeysFor(null)

  it('links an open library deadline to the checklist that completes it', () => {
    expect(checklistHref(deadline({ id: 'abc', library_key: 'sw-fed-routine-inspection' }), keys))
      .toBe('/environmental/compliance/checklists?start=sw-routine-inspection&obligation=abc')
  })

  it('has no link for a custom deadline, one the library gives no checklist, or one that is not open', () => {
    expect(checklistHref(deadline({ library_key: null }), keys)).toBeNull()
    expect(checklistHref(deadline({ library_key: 'ww-fed-ciu-report' }), keys)).toBeNull()
    expect(checklistHref(deadline({ library_key: 'permit-renewal:abc' }), keys)).toBeNull()
    expect(checklistHref(deadline({ library_key: 'sw-fed-routine-inspection', status: 'completed' }), keys)).toBeNull()
  })
})
