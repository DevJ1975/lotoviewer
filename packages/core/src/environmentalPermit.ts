// The permit vault: permits, registrations and plans an agency issued to a
// site, or the site filed with one (EMS plan Lessons L8 and L9). Pure rules
// for the renewal countdown, a permit's standing, the holder-of-record
// check, the register's light, and the notices the nightly job owes.
//
// A permit's conditions are compliance obligations linked to it (Phase 2
// plan D3), so their rules live in complianceEvaluation.ts and
// complianceCalendar.ts; only their reminders are here.

import type { FieldError } from './hazardousWaste'
import { parseJurisdiction } from './complianceEvaluation'
import {
  addCalendarDays,
  calendarDaysBetween,
  isCalendarDate,
  sameLegalEntity,
  type RegisterHealth,
} from './managementSystem'

export const PERMIT_PROGRAMS = ['air', 'waste', 'wastewater', 'stormwater', 'spcc', 'epcra', 'other'] as const
export type PermitProgram = typeof PERMIT_PROGRAMS[number]

export const PERMIT_PROGRAM_LABELS: Readonly<Record<PermitProgram, string>> = {
  air:        'Air',
  waste:      'Waste',
  wastewater: 'Wastewater',
  stormwater: 'Stormwater',
  spcc:       'Spill prevention (SPCC)',
  epcra:      'Community right-to-know (EPCRA)',
  other:      'Other',
}

/** What kind of paper it is: an agency's permit, a registration the site filed, or a plan it keeps. */
export const PERMIT_INSTRUMENTS = ['permit', 'registration', 'plan'] as const
export type PermitInstrument = typeof PERMIT_INSTRUMENTS[number]

// ── The renewal countdown (Phase 2 plan D6) ──────────────────────────────

/**
 * Days before the renewal deadline at which the countdown escalates. This is
 * the EMS plan's product policy, not a regulatory lead time: what a permit
 * actually requires comes from its own terms, as renewalApplicationDueOn.
 */
export const RENEWAL_TIER_DAYS = [180, 90, 30] as const
export type RenewalTier = 'none' | typeof RENEWAL_TIER_DAYS[number] | 'passed'

export interface RenewalDates {
  /** When the renewal application must reach the agency, from the permit's own terms; null when it gives none. */
  renewalApplicationDueOn: string | null
  /** When the permit lapses; null for a permit with no fixed term, such as a permit by rule. */
  expiresOn:               string | null
}

/** The date the countdown runs to: the renewal application due date when the permit gives one, else its expiry. */
export function renewalDeadline(dates: RenewalDates): string | null {
  return dates.renewalApplicationDueOn ?? dates.expiresOn
}

export interface Escalation {
  tier:       RenewalTier
  /** Calendar days from today to the deadline; negative once it has passed. */
  daysLeft:   number
  /** The date the next, more urgent tier starts; null once the deadline has passed. */
  nextTierOn: string | null
}

/**
 * Where today falls in the countdown to a deadline. The deadline day itself
 * is still the 30-day tier; the day after it, the deadline has passed.
 * @param deadline ISO calendar date.
 * @param today    ISO calendar date.
 */
export function permitEscalation(deadline: string, today: string): Escalation {
  const daysLeft = calendarDaysBetween(today, deadline)
  if (daysLeft < 0) return { tier: 'passed', daysLeft, nextTierOn: null }
  const tightestReached = [...RENEWAL_TIER_DAYS].reverse().find(days => daysLeft <= days)
  const tier: RenewalTier = tightestReached ?? 'none'
  const tighter = RENEWAL_TIER_DAYS.filter(days => tier === 'none' || days < tier)
  const nextTierOn = tighter.length > 0
    ? addCalendarDays(deadline, -Math.max(...tighter))
    : addCalendarDays(deadline, 1)
  return { tier, daysLeft, nextTierOn }
}

// ── Standing (D7) ────────────────────────────────────────────────────────

export interface PermitForStanding extends RenewalDates {
  /** Set once the permit is retired: it stays in history and leaves every countdown. */
  retiredAt:          string | null
  /** When the renewal application was submitted for the current term; null when it has not been. */
  renewalSubmittedOn: string | null
}

export type PermitStanding =
  | 'retired'
  | 'no_expiry'
  | 'current'
  | 'renewal_due'
  | 'renewal_submitted'
  | 'expired'
  | 'expired_renewal_pending'

/**
 * A permit's place in its renewal cycle.
 *
 * Once a renewal is submitted the countdown stops. Whether an expired permit
 * stays in force while the agency reviews a timely renewal depends on the
 * program and the agency, so `expired_renewal_pending` does not say; the
 * screens tell people to confirm with the agency.
 */
export function permitStanding(permit: PermitForStanding, today: string): PermitStanding {
  if (permit.retiredAt !== null) return 'retired'
  const deadline = renewalDeadline(permit)
  if (deadline === null) return 'no_expiry'
  const expired = permit.expiresOn !== null && permit.expiresOn < today
  if (permit.renewalSubmittedOn !== null) return expired ? 'expired_renewal_pending' : 'renewal_submitted'
  if (expired) return 'expired'
  return permitEscalation(deadline, today).tier === 'none' ? 'current' : 'renewal_due'
}

/**
 * True for an active permit whose renewal deadline has passed with no renewal
 * submitted: the application was missed, or the permit has lapsed.
 */
export function renewalDeadlineMissed(permit: PermitForStanding, today: string): boolean {
  if (permit.retiredAt !== null || permit.renewalSubmittedOn !== null) return false
  const deadline = renewalDeadline(permit)
  return deadline !== null && deadline < today
}

// ── Holder of record (D11) ───────────────────────────────────────────────

/**
 * Whether a permit names a holder other than the legal entity in the scope
 * in force. Null when no scope is recorded, so there is nothing to compare.
 */
export function holderOfRecordMismatch(holderOfRecord: string, legalEntityInForce: string | null): boolean | null {
  return legalEntityInForce === null ? null : !sameLegalEntity(holderOfRecord, legalEntityInForce)
}

// ── Register health (D17, Q1) ────────────────────────────────────────────

export interface PermitHealthRow extends PermitForStanding {
  holderOfRecord: string
  nextReviewDue:  string
}

export interface PermitsHealthInput {
  /** Every permit, retired ones included. */
  permits:            readonly PermitHealthRow[]
  /** Permit conditions past their due date. */
  conditionsOverdue:  number
  /** The legal entity of the scope in force; null when no scope is recorded. */
  legalEntityInForce: string | null
  today:              string
}

/**
 * The permits register's light.
 * - `red`: a renewal deadline has passed with no renewal submitted, or a
 *   permit names a holder other than the scope's legal entity.
 * - `amber`: no permits recorded (a site may hold none, and the platform
 *   cannot tell, so emptiness is not a gap); a renewal deadline within 90
 *   days with nothing submitted; an expired permit whose renewal is pending;
 *   an overdue condition; a permit past its register review date.
 * - `green`: otherwise.
 */
export function permitsHealth(input: PermitsHealthInput): RegisterHealth {
  const { permits, conditionsOverdue, legalEntityInForce, today } = input
  const active = permits.filter(permit => permit.retiredAt === null)
  if (active.length === 0) return 'amber'

  const danger = active.some(permit =>
    renewalDeadlineMissed(permit, today)
    || holderOfRecordMismatch(permit.holderOfRecord, legalEntityInForce) === true)
  if (danger) return 'red'

  const renewalSoon = (permit: PermitHealthRow) => {
    const deadline = renewalDeadline(permit)
    if (deadline === null || permit.renewalSubmittedOn !== null) return false
    const { tier } = permitEscalation(deadline, today)
    return tier === 90 || tier === 30
  }
  const attention = conditionsOverdue > 0 || active.some(permit =>
    permit.nextReviewDue < today
    || renewalSoon(permit)
    || permitStanding(permit, today) === 'expired_renewal_pending')
  return attention ? 'amber' : 'green'
}

// ── Notices the nightly job owes (D8–D10) ────────────────────────────────

/**
 * The key ms_notification_log stores for one notice about one record. The
 * job claims it before sending, so a notice goes out once.
 */
export function sentNoticeKey(subjectId: string, noticeKey: string): string {
  return `${subjectId}/${noticeKey}`
}

export interface PermitForNotice extends PermitForStanding {
  id:               string
  businessCritical: boolean
}

export interface RenewalNotice {
  permitId:  string
  tier:      Exclude<RenewalTier, 'none'>
  deadline:  string
  /** ms_notification_log.notice_key. The deadline is part of it, so a new term starts a new countdown. */
  noticeKey: string
  /** True for a business-critical permit at 30 days or past its deadline: owners and admins hear about it too (D8). */
  escalate:  boolean
}

/**
 * The renewal notices due today: one per active permit, for the tier it is
 * in now, unless already sent. A job that missed days sends only the current
 * tier, not every tier it skipped. A submitted renewal stops the notices.
 * @param alreadySent sentNoticeKey() values already in the log.
 */
export function renewalNoticesDue(
  permits: readonly PermitForNotice[],
  today: string,
  alreadySent: ReadonlySet<string>,
): RenewalNotice[] {
  const notices: RenewalNotice[] = []
  for (const permit of permits) {
    if (permit.retiredAt !== null || permit.renewalSubmittedOn !== null) continue
    const deadline = renewalDeadline(permit)
    if (deadline === null) continue
    const { tier } = permitEscalation(deadline, today)
    if (tier === 'none') continue
    const noticeKey = `renewal:${tier}:${deadline}`
    if (alreadySent.has(sentNoticeKey(permit.id, noticeKey))) continue
    notices.push({
      permitId: permit.id,
      tier,
      deadline,
      noticeKey,
      escalate: permit.businessCritical && (tier === 30 || tier === 'passed'),
    })
  }
  return notices
}

/** Days before a permit condition falls due that its owner is reminded (Q5). */
export const CONDITION_REMINDER_LEAD_DAYS = 14

export interface ConditionForNotice {
  id:        string
  /** ISO calendar date the condition is next due. */
  nextDueAt: string
  /** False once the obligation is completed or dismissed. */
  active:    boolean
}

export interface ConditionReminder {
  obligationId: string
  dueOn:        string
  stage:        'due_soon' | 'overdue'
  noticeKey:    string
}

/**
 * Reminders due today for permit conditions: one when a condition comes
 * within the lead time, and one when it becomes overdue. Each is keyed by
 * the due date, so marking the condition done (which moves the date on)
 * starts the next cycle. A condition first seen already overdue gets only
 * the overdue reminder.
 */
export function conditionRemindersDue(
  conditions: readonly ConditionForNotice[],
  today: string,
  alreadySent: ReadonlySet<string>,
  leadDays: number = CONDITION_REMINDER_LEAD_DAYS,
): ConditionReminder[] {
  const reminders: ConditionReminder[] = []
  for (const condition of conditions) {
    if (!condition.active) continue
    const daysLeft = calendarDaysBetween(today, condition.nextDueAt)
    if (daysLeft > leadDays) continue
    const stage = daysLeft < 0 ? 'overdue' : 'due_soon'
    const noticeKey = `condition:${stage}:${condition.nextDueAt}`
    if (alreadySent.has(sentNoticeKey(condition.id, noticeKey))) continue
    reminders.push({ obligationId: condition.id, dueOn: condition.nextDueAt, stage, noticeKey })
  }
  return reminders
}

// ── Inputs ───────────────────────────────────────────────────────────────

export interface PermitInput {
  program:                 PermitProgram
  instrument:              PermitInstrument
  title:                   string
  agency:                  string
  permitNumber:            string | null
  /** 'federal', 'state:XX' or 'local:<name>', as on obligations. */
  jurisdiction:            string
  holderOfRecord:          string
  issuedOn:                string | null
  expiresOn:               string | null
  renewalApplicationDueOn: string | null
  businessCritical:        boolean
  notes:                   string | null
}

function requireText(errors: FieldError[], field: string, value: string, max: number): void {
  if (value.trim().length === 0) errors.push({ field, message: 'is required' })
  else if (value.length > max) errors.push({ field, message: `must be at most ${max} characters` })
}

function optionalDate(errors: FieldError[], field: string, value: string | null): boolean {
  if (value === null) return true
  if (isCalendarDate(value)) return true
  errors.push({ field, message: 'must be a date (YYYY-MM-DD)' })
  return false
}

/** A permit's term: expiry after issue, and a renewal application due on or before expiry. */
function validateTerm(
  errors: FieldError[],
  term: { issuedOn: string | null; expiresOn: string | null; renewalApplicationDueOn: string | null },
): void {
  const datesValid = [
    optionalDate(errors, 'issuedOn', term.issuedOn),
    optionalDate(errors, 'expiresOn', term.expiresOn),
    optionalDate(errors, 'renewalApplicationDueOn', term.renewalApplicationDueOn),
  ].every(Boolean)
  if (!datesValid) return
  if (term.issuedOn !== null && term.expiresOn !== null && term.expiresOn <= term.issuedOn) {
    errors.push({ field: 'expiresOn', message: 'must be after the issue date' })
  }
  if (term.renewalApplicationDueOn !== null) {
    if (term.expiresOn === null) {
      errors.push({ field: 'renewalApplicationDueOn', message: 'needs an expiry date' })
    } else if (term.renewalApplicationDueOn > term.expiresOn) {
      errors.push({ field: 'renewalApplicationDueOn', message: 'must be on or before the expiry date' })
    }
  }
}

/** Validate a permit's fields. Empty means acceptable. Mirrors migration 304's checks. */
export function validatePermitInput(input: PermitInput): FieldError[] {
  const errors: FieldError[] = []
  if (!PERMIT_PROGRAMS.includes(input.program)) {
    errors.push({ field: 'program', message: `must be one of ${PERMIT_PROGRAMS.join(', ')}` })
  }
  if (!PERMIT_INSTRUMENTS.includes(input.instrument)) {
    errors.push({ field: 'instrument', message: 'must be permit, registration, or plan' })
  }
  requireText(errors, 'title', input.title, 200)
  requireText(errors, 'agency', input.agency, 200)
  if (input.permitNumber !== null) requireText(errors, 'permitNumber', input.permitNumber, 100)
  if (parseJurisdiction(input.jurisdiction) === null) {
    errors.push({ field: 'jurisdiction', message: "must be 'federal', 'state:XX', or 'local:<name>'" })
  }
  requireText(errors, 'holderOfRecord', input.holderOfRecord, 300)
  validateTerm(errors, input)
  if (input.notes !== null && input.notes.length > 4000) {
    errors.push({ field: 'notes', message: 'must be at most 4000 characters' })
  }
  return errors
}

/**
 * "Renewal submitted on": not in the future, and not before the current
 * term was issued.
 * @param latestDate The latest calendar date anywhere today, so a site ahead of UTC is not refused.
 */
export function validateRenewalSubmission(
  submittedOn: string,
  term: { issuedOn: string | null },
  latestDate: string,
): FieldError[] {
  if (!isCalendarDate(submittedOn)) return [{ field: 'submittedOn', message: 'must be a date (YYYY-MM-DD)' }]
  if (submittedOn > latestDate) return [{ field: 'submittedOn', message: 'cannot be in the future' }]
  if (term.issuedOn !== null && submittedOn < term.issuedOn) {
    return [{ field: 'submittedOn', message: `cannot be before the current term was issued (${term.issuedOn})` }]
  }
  return []
}

export interface RenewedTermInput {
  issuedOn:                string
  expiresOn:               string | null
  renewalApplicationDueOn: string | null
  /** A renewal may carry a new number; null keeps the current one. */
  permitNumber:            string | null
}

/** The new term recorded when the agency renews a permit. It must start after the term it replaces did. */
export function validateRenewedTerm(input: RenewedTermInput, previousIssuedOn: string | null): FieldError[] {
  const errors: FieldError[] = []
  const issuedOnValid = isCalendarDate(input.issuedOn)
  if (!issuedOnValid) {
    errors.push({ field: 'issuedOn', message: 'is required: a date (YYYY-MM-DD)' })
  } else if (previousIssuedOn !== null && input.issuedOn <= previousIssuedOn) {
    errors.push({ field: 'issuedOn', message: `must be after the current term's issue date (${previousIssuedOn})` })
  }
  validateTerm(errors, { ...input, issuedOn: issuedOnValid ? input.issuedOn : null })
  if (input.permitNumber !== null) requireText(errors, 'permitNumber', input.permitNumber, 100)
  return errors
}
