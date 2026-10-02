import { describe, it, expect } from 'vitest'
import {
  CONDITION_REMINDER_LEAD_DAYS,
  RENEWAL_TIER_DAYS,
  conditionRemindersDue,
  holderOfRecordMismatch,
  permitEscalation,
  permitStanding,
  permitsHealth,
  renewalDeadline,
  renewalDeadlineMissed,
  renewalNoticesDue,
  sentNoticeKey,
  validatePermitInput,
  validateRenewalSubmission,
  validateRenewedTerm,
  type PermitForNotice,
  type PermitHealthRow,
  type PermitInput,
} from '../environmentalPermit'
import { addCalendarDays } from '../managementSystem'

const TODAY = '2026-10-02'
const inDays = (days: number) => addCalendarDays(TODAY, days)

describe('renewalDeadline', () => {
  it('prefers the renewal application due date the permit gives', () => {
    expect(renewalDeadline({ renewalApplicationDueOn: '2027-01-01', expiresOn: '2027-07-01' })).toBe('2027-01-01')
  })

  it('falls back to the expiry date', () => {
    expect(renewalDeadline({ renewalApplicationDueOn: null, expiresOn: '2027-07-01' })).toBe('2027-07-01')
  })

  it('is null for a permit with no fixed term', () => {
    expect(renewalDeadline({ renewalApplicationDueOn: null, expiresOn: null })).toBeNull()
  })
})

describe('permitEscalation', () => {
  it('escalates at the plan\'s 180, 90 and 30 days', () => {
    expect(RENEWAL_TIER_DAYS).toEqual([180, 90, 30])
  })

  it.each([
    [181, 'none'],
    [180, 180],
    [91, 180],
    [90, 90],
    [31, 90],
    [30, 30],
    [1, 30],
    [0, 30],
    [-1, 'passed'],
    [-400, 'passed'],
  ] as const)('%i days before the deadline is tier %s', (daysLeft, tier) => {
    const escalation = permitEscalation(inDays(daysLeft), TODAY)
    expect(escalation.tier).toBe(tier)
    expect(escalation.daysLeft).toBe(daysLeft)
  })

  it('says when the next, more urgent tier starts', () => {
    const deadline = '2027-06-30'
    expect(permitEscalation(deadline, '2026-10-02').nextTierOn).toBe('2027-01-01')   // none -> 180
    expect(permitEscalation(deadline, '2027-01-01').nextTierOn).toBe('2027-04-01')   // 180 -> 90
    expect(permitEscalation(deadline, '2027-04-01').nextTierOn).toBe('2027-05-31')   // 90 -> 30
    expect(permitEscalation(deadline, '2027-05-31').nextTierOn).toBe('2027-07-01')   // 30 -> passed
    expect(permitEscalation(deadline, '2027-07-01').nextTierOn).toBeNull()
  })

  it('counts calendar days across a leap day and a year boundary', () => {
    expect(permitEscalation('2028-03-01', '2028-01-31').daysLeft).toBe(30)
    expect(permitEscalation('2028-03-01', '2028-01-31').tier).toBe(30)
    expect(permitEscalation('2027-01-01', '2026-12-31').daysLeft).toBe(1)
  })
})

describe('permitStanding', () => {
  const permit = (overrides: Partial<Parameters<typeof permitStanding>[0]> = {}) => ({
    retiredAt: null, expiresOn: inDays(400), renewalApplicationDueOn: null, renewalSubmittedOn: null, ...overrides,
  })

  it.each([
    ['retired, even past its expiry', { retiredAt: '2026-01-01T00:00:00Z', expiresOn: inDays(-10) }, 'retired'],
    ['no fixed term', { expiresOn: null }, 'no_expiry'],
    ['more than 180 days out', {}, 'current'],
    ['inside 180 days', { expiresOn: inDays(120) }, 'renewal_due'],
    ['past its application date but not expired', { expiresOn: inDays(60), renewalApplicationDueOn: inDays(-5) }, 'renewal_due'],
    ['submitted, not yet expired', { expiresOn: inDays(20), renewalSubmittedOn: inDays(-30) }, 'renewal_submitted'],
    ['expired with nothing submitted', { expiresOn: inDays(-1) }, 'expired'],
    ['expired with a renewal pending', { expiresOn: inDays(-1), renewalSubmittedOn: inDays(-90) }, 'expired_renewal_pending'],
  ] as const)('is %s', (_label, overrides, standing) => {
    expect(permitStanding(permit(overrides), TODAY)).toBe(standing)
  })

  it('treats the expiry day itself as not yet expired', () => {
    expect(permitStanding(permit({ expiresOn: TODAY }), TODAY)).toBe('renewal_due')
  })
})

describe('renewalDeadlineMissed', () => {
  const base = { retiredAt: null, expiresOn: inDays(60), renewalApplicationDueOn: inDays(-1), renewalSubmittedOn: null }

  it('is true once the application date has passed with nothing submitted', () => {
    expect(renewalDeadlineMissed(base, TODAY)).toBe(true)
  })

  it('is false on the deadline day, once submitted, once retired, and with no term', () => {
    expect(renewalDeadlineMissed({ ...base, renewalApplicationDueOn: TODAY }, TODAY)).toBe(false)
    expect(renewalDeadlineMissed({ ...base, renewalSubmittedOn: inDays(-3) }, TODAY)).toBe(false)
    expect(renewalDeadlineMissed({ ...base, retiredAt: '2026-09-01T00:00:00Z' }, TODAY)).toBe(false)
    expect(renewalDeadlineMissed({ ...base, expiresOn: null, renewalApplicationDueOn: null }, TODAY)).toBe(false)
  })
})

describe('holderOfRecordMismatch', () => {
  it('is false when the names are the same entity', () => {
    expect(holderOfRecordMismatch('Northfield Forge & Finish, LLC', 'Northfield Forge & Finish LLC')).toBe(false)
  })

  it('is true when the permit names someone else', () => {
    expect(holderOfRecordMismatch('Northfield Metal Products Inc.', 'Northfield Forge & Finish LLC')).toBe(true)
  })

  it('is null when no scope is recorded to compare against', () => {
    expect(holderOfRecordMismatch('Anyone', null)).toBeNull()
  })
})

describe('permitsHealth', () => {
  const ENTITY = 'Northfield Forge & Finish LLC'
  const row = (overrides: Partial<PermitHealthRow> = {}): PermitHealthRow => ({
    retiredAt: null, expiresOn: inDays(400), renewalApplicationDueOn: null, renewalSubmittedOn: null,
    holderOfRecord: ENTITY, nextReviewDue: inDays(100), ...overrides,
  })
  const health = (permits: PermitHealthRow[], conditionsOverdue = 0, legalEntityInForce: string | null = ENTITY) =>
    permitsHealth({ permits, conditionsOverdue, legalEntityInForce, today: TODAY })

  it('is amber when no permits are recorded, because a site may hold none', () => {
    expect(health([])).toBe('amber')
    expect(health([row({ retiredAt: '2026-01-01T00:00:00Z' })])).toBe('amber')
  })

  it('is green when every permit is in order', () => {
    expect(health([row(), row({ expiresOn: null })])).toBe('green')
  })

  it('is red when a renewal deadline has passed with nothing submitted', () => {
    expect(health([row(), row({ expiresOn: inDays(-1) })])).toBe('red')
  })

  it('is red when a permit names another holder', () => {
    expect(health([row({ holderOfRecord: 'Northfield Metal Products Inc.' })])).toBe('red')
  })

  it('does not flag a holder when no scope is recorded', () => {
    expect(health([row({ holderOfRecord: 'Northfield Metal Products Inc.' })], 0, null)).toBe('green')
  })

  it.each([
    ['a renewal within 90 days', { expiresOn: inDays(90) }],
    ['a renewal within 30 days', { expiresOn: inDays(10) }],
    ['an expired permit with a renewal pending', { expiresOn: inDays(-5), renewalSubmittedOn: inDays(-60) }],
    ['a register review overdue', { nextReviewDue: inDays(-1) }],
  ] as const)('is amber for %s', (_label, overrides) => {
    expect(health([row(overrides)])).toBe('amber')
  })

  it('stays green at 91 days, and once a renewal is submitted inside 90 days', () => {
    expect(health([row({ expiresOn: inDays(91) })])).toBe('green')
    expect(health([row({ expiresOn: inDays(40), renewalSubmittedOn: inDays(-1) })])).toBe('green')
  })

  it('is amber when a permit condition is overdue', () => {
    expect(health([row()], 1)).toBe('amber')
  })
})

describe('renewalNoticesDue', () => {
  const permit = (overrides: Partial<PermitForNotice> = {}): PermitForNotice => ({
    id: 'p1', businessCritical: false, retiredAt: null, expiresOn: inDays(400),
    renewalApplicationDueOn: null, renewalSubmittedOn: null, ...overrides,
  })
  const none = new Set<string>()

  it('sends one notice for the tier the permit is in now', () => {
    const notices = renewalNoticesDue([permit({ expiresOn: inDays(29) })], TODAY, none)
    expect(notices).toEqual([{
      permitId: 'p1', tier: 30, deadline: inDays(29), noticeKey: `renewal:30:${inDays(29)}`, escalate: false,
    }])
  })

  it('sends nothing outside 180 days, for no term, once submitted, or once retired', () => {
    expect(renewalNoticesDue([
      permit({ id: 'a' }),
      permit({ id: 'b', expiresOn: null }),
      permit({ id: 'c', expiresOn: inDays(20), renewalSubmittedOn: inDays(-1) }),
      permit({ id: 'd', expiresOn: inDays(20), retiredAt: '2026-09-01T00:00:00Z' }),
    ], TODAY, none)).toEqual([])
  })

  it('never re-sends a notice already in the log', () => {
    const p = permit({ expiresOn: inDays(100) })
    const sent = new Set([sentNoticeKey('p1', `renewal:180:${inDays(100)}`)])
    expect(renewalNoticesDue([p], TODAY, sent)).toEqual([])
  })

  it('starts a new countdown when the deadline moves', () => {
    const sent = new Set([sentNoticeKey('p1', `renewal:30:${inDays(10)}`)])
    expect(renewalNoticesDue([permit({ expiresOn: inDays(25) })], TODAY, sent)).toHaveLength(1)
  })

  it('counts to the renewal application date when the permit gives one', () => {
    const [notice] = renewalNoticesDue([permit({ expiresOn: inDays(300), renewalApplicationDueOn: inDays(85) })], TODAY, none)
    expect(notice.tier).toBe(90)
    expect(notice.deadline).toBe(inDays(85))
  })

  it('escalates a business-critical permit at 30 days and once passed, not before', () => {
    const at = (days: number) => renewalNoticesDue([permit({ businessCritical: true, expiresOn: inDays(days) })], TODAY, none)[0]
    expect(at(120).escalate).toBe(false)
    expect(at(60).escalate).toBe(false)
    expect(at(30).escalate).toBe(true)
    expect(at(-2).escalate).toBe(true)
    expect(at(-2).tier).toBe('passed')
  })
})

describe('conditionRemindersDue', () => {
  const none = new Set<string>()
  const condition = (nextDueAt: string, active = true) => ({ id: 'o1', nextDueAt, active })

  it('reminds 14 days ahead, not 15', () => {
    expect(CONDITION_REMINDER_LEAD_DAYS).toBe(14)
    expect(conditionRemindersDue([condition(inDays(15))], TODAY, none)).toEqual([])
    expect(conditionRemindersDue([condition(inDays(14))], TODAY, none)).toEqual([
      { obligationId: 'o1', dueOn: inDays(14), stage: 'due_soon', noticeKey: `condition:due_soon:${inDays(14)}` },
    ])
  })

  it('treats the due date itself as due soon, and the day after as overdue', () => {
    expect(conditionRemindersDue([condition(TODAY)], TODAY, none)[0].stage).toBe('due_soon')
    expect(conditionRemindersDue([condition(inDays(-1))], TODAY, none)[0].stage).toBe('overdue')
  })

  it('sends the overdue reminder once', () => {
    const sent = new Set([sentNoticeKey('o1', `condition:overdue:${inDays(-3)}`)])
    expect(conditionRemindersDue([condition(inDays(-3))], TODAY, sent)).toEqual([])
  })

  it('starts the next cycle when the condition is done and its date moves on', () => {
    const sent = new Set([sentNoticeKey('o1', `condition:due_soon:${inDays(-80)}`)])
    expect(conditionRemindersDue([condition(inDays(10))], TODAY, sent)).toHaveLength(1)
  })

  it('skips a completed or dismissed condition, and honours a different lead time', () => {
    expect(conditionRemindersDue([condition(inDays(3), false)], TODAY, none)).toEqual([])
    expect(conditionRemindersDue([condition(inDays(20))], TODAY, none, 30)).toHaveLength(1)
  })
})

describe('validatePermitInput', () => {
  const valid: PermitInput = {
    program: 'wastewater', instrument: 'permit', title: 'Industrial wastewater discharge permit',
    agency: 'City of Northfield', permitNumber: 'DEMO-IWD-0001', jurisdiction: 'local:Northfield',
    holderOfRecord: 'Northfield Forge & Finish LLC', issuedOn: '2022-01-01', expiresOn: '2027-01-01',
    renewalApplicationDueOn: '2026-07-01', businessCritical: true, notes: null,
  }
  const fields = (input: PermitInput) => validatePermitInput(input).map(error => error.field)

  it('accepts a complete permit, and one with no number or term', () => {
    expect(validatePermitInput(valid)).toEqual([])
    expect(validatePermitInput({ ...valid, permitNumber: null, issuedOn: null, expiresOn: null, renewalApplicationDueOn: null })).toEqual([])
  })

  it('requires a title, an agency, a holder and a well-formed jurisdiction', () => {
    expect(fields({ ...valid, title: ' ', agency: '', holderOfRecord: '  ', jurisdiction: 'state:tx' }))
      .toEqual(['title', 'agency', 'jurisdiction', 'holderOfRecord'])
  })

  it('refuses an unknown program or instrument', () => {
    expect(fields({ ...valid, program: 'noise' as never, instrument: 'licence' as never })).toEqual(['program', 'instrument'])
  })

  it('needs expiry after issue, and an application date no later than expiry', () => {
    expect(fields({ ...valid, expiresOn: '2022-01-01', renewalApplicationDueOn: null })).toEqual(['expiresOn'])
    expect(fields({ ...valid, renewalApplicationDueOn: '2027-01-02' })).toEqual(['renewalApplicationDueOn'])
    expect(fields({ ...valid, expiresOn: null, renewalApplicationDueOn: '2026-07-01' })).toEqual(['renewalApplicationDueOn'])
    expect(validatePermitInput({ ...valid, renewalApplicationDueOn: '2027-01-01' })).toEqual([])
  })

  it('refuses a malformed or impossible date', () => {
    expect(fields({ ...valid, issuedOn: '2026-02-30' })).toEqual(['issuedOn'])
  })

  it('caps the free-text fields', () => {
    expect(fields({ ...valid, permitNumber: 'x'.repeat(101), notes: 'x'.repeat(4001) })).toEqual(['permitNumber', 'notes'])
  })
})

describe('validateRenewalSubmission', () => {
  it('accepts a past date within the current term', () => {
    expect(validateRenewalSubmission('2026-09-15', { issuedOn: '2022-01-01' }, '2026-10-03')).toEqual([])
  })

  it('refuses the future, a date before the term, and a malformed date', () => {
    expect(validateRenewalSubmission('2026-10-04', { issuedOn: null }, '2026-10-03')[0].message).toBe('cannot be in the future')
    expect(validateRenewalSubmission('2021-12-31', { issuedOn: '2022-01-01' }, '2026-10-03')[0].message)
      .toBe('cannot be before the current term was issued (2022-01-01)')
    expect(validateRenewalSubmission('soon', { issuedOn: null }, '2026-10-03')[0].field).toBe('submittedOn')
  })
})

describe('validateRenewedTerm', () => {
  const term = { issuedOn: '2027-01-01', expiresOn: '2032-01-01', renewalApplicationDueOn: null, permitNumber: null }

  it('accepts a new term that starts after the old one', () => {
    expect(validateRenewedTerm(term, '2022-01-01')).toEqual([])
  })

  it('refuses a term that does not start after the current one', () => {
    expect(validateRenewedTerm({ ...term, issuedOn: '2022-01-01' }, '2022-01-01').map(e => e.field)).toEqual(['issuedOn'])
  })

  it('reports a missing issue date once', () => {
    expect(validateRenewedTerm({ ...term, issuedOn: '' }, '2022-01-01')).toEqual([
      { field: 'issuedOn', message: 'is required: a date (YYYY-MM-DD)' },
    ])
  })

  it('checks the new term like any permit term', () => {
    expect(validateRenewedTerm({ ...term, expiresOn: '2026-12-31' }, null).map(e => e.field)).toEqual(['expiresOn'])
  })
})
