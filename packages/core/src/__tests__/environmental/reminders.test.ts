import { describe, it, expect } from 'vitest'
import {
  obligationIdsOf, planReminders, reminderDue, REMINDER_INTERVAL_DAYS, type ReminderObligation, type TenantPeople,
} from '../../environmental/reminders'

const NOW = new Date('2026-10-07T12:00:00Z')

const ob = (over: Partial<ReminderObligation> = {}): ReminderObligation => ({
  id: 'o1', tenant_id: 't1', facility_id: 'f1', title: 'Quarterly inspection', regulatory_ref: 'IGP', status: 'open',
  next_due_at: '2026-10-20', lead_days: 30, last_reminded_on: null, owner_user_id: null, ...over,
})

describe('reminderDue', () => {
  it('waits for the reminder window to open', () => {
    expect(reminderDue(ob({ next_due_at: '2026-11-06' }), NOW)).toBe(true)    // 30 days out: the window opens today
    expect(reminderDue(ob({ next_due_at: '2026-11-07' }), NOW)).toBe(false)   // 31 days out
  })

  it('keeps reminding once a deadline has passed', () => {
    expect(reminderDue(ob({ next_due_at: '2026-09-01' }), NOW)).toBe(true)
  })

  it('reminds again only after a week', () => {
    expect(REMINDER_INTERVAL_DAYS).toBe(7)
    expect(reminderDue(ob({ last_reminded_on: '2026-10-01' }), NOW)).toBe(false)  // 6 days ago
    expect(reminderDue(ob({ last_reminded_on: '2026-09-30' }), NOW)).toBe(true)   // 7 days ago
    expect(reminderDue(ob({ last_reminded_on: '2026-10-07' }), NOW)).toBe(false)  // today: a second run the same day is a no-op
  })

  it('never reminds about a deadline that is not open', () => {
    for (const status of ['completed', 'dismissed']) expect(reminderDue(ob({ status }), NOW)).toBe(false)
  })

  it('honours a short or zero window', () => {
    expect(reminderDue(ob({ lead_days: 0, next_due_at: '2026-10-08' }), NOW)).toBe(false)
    expect(reminderDue(ob({ lead_days: 0, next_due_at: '2026-10-07' }), NOW)).toBe(true)
  })
})

const people = (over: Record<string, Partial<TenantPeople>> = {}): Map<string, TenantPeople> => new Map([
  ['t1', { memberIds: new Set(['admin1', 'admin2', 'pat']), adminIds: ['admin1', 'admin2'], ...over.t1 }],
  ['t2', { memberIds: new Set(['boss']), adminIds: ['boss'], ...over.t2 }],
])

describe('planReminders', () => {
  it('sends a deadline to its owner alone', () => {
    const [digest, ...rest] = planReminders([ob({ owner_user_id: 'pat' })], people(), NOW)
    expect(rest).toEqual([])
    expect(digest).toMatchObject({ tenantId: 't1', userId: 'pat' })
    expect(digest!.items).toHaveLength(1)
  })

  it('sends an unassigned deadline to every admin, so it is never nobody\'s', () => {
    const digests = planReminders([ob()], people(), NOW)
    expect(digests.map(d => d.userId)).toEqual(['admin1', 'admin2'])
  })

  it('falls back to the admins when the owner has left the tenant', () => {
    const digests = planReminders([ob({ owner_user_id: 'gone' })], people(), NOW)
    expect(digests.map(d => d.userId)).toEqual(['admin1', 'admin2'])
  })

  it('puts several deadlines for one person in one digest, most urgent first', () => {
    const digests = planReminders([
      ob({ id: 'a', title: 'Later', next_due_at: '2026-10-25', owner_user_id: 'pat' }),
      ob({ id: 'b', title: 'Overdue', next_due_at: '2026-09-30', owner_user_id: 'pat' }),
      ob({ id: 'c', title: 'Soon', next_due_at: '2026-10-10', owner_user_id: 'pat' }),
    ], people(), NOW)
    expect(digests).toHaveLength(1)
    expect(digests[0]!.items.map(i => i.title)).toEqual(['Overdue', 'Soon', 'Later'])
    expect(digests[0]!.items[0]).toMatchObject({ overdue: true, days: -7 })
    expect(digests[0]!.items[1]).toMatchObject({ overdue: false, days: 3 })
  })

  it('never mixes tenants: each tenant\'s deadlines go to that tenant\'s people', () => {
    const digests = planReminders([ob({ id: 'a' }), ob({ id: 'b', tenant_id: 't2' })], people(), NOW)
    expect(digests.map(d => `${d.tenantId}:${d.userId}`)).toEqual(['t1:admin1', 't1:admin2', 't2:boss'])
    expect(digests.find(d => d.userId === 'boss')!.items.map(i => i.obligationId)).toEqual(['b'])
  })

  it('skips a tenant it knows nothing about, and deadlines not yet due or reminded this week', () => {
    expect(planReminders([ob({ tenant_id: 'unknown' })], people(), NOW)).toEqual([])
    expect(planReminders([ob({ next_due_at: '2027-06-01' }), ob({ id: 'x', last_reminded_on: '2026-10-05' })], people(), NOW)).toEqual([])
  })

  it('lists the deadlines to stamp as reminded, once each however many people were told', () => {
    const digests = planReminders([ob({ id: 'a' }), ob({ id: 'b', owner_user_id: 'pat' })], people(), NOW)
    expect(obligationIdsOf(digests).sort()).toEqual(['a', 'b'])
  })

  it('is deterministic: the same input gives the same digests in the same order', () => {
    const input = [ob({ id: 'a' }), ob({ id: 'b', tenant_id: 't2' }), ob({ id: 'c', owner_user_id: 'pat' })]
    expect(planReminders(input, people(), NOW)).toEqual(planReminders([...input].reverse(), people(), NOW))
  })
})
