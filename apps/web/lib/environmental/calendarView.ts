import { buildMonthGrid, classifyUrgency, daysUntilDue, type ObligationCadence } from '@soteria/core/complianceCalendar'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { ENV_PROGRAM_LABELS, type EnvProgram } from '@soteria/core/environmental/siteProfile'
import type { Deadline } from './client'

// The calendar screen's decisions, as pure functions over rows already fetched:
// which urgency a deadline falls in, how a month lays out, how to word a date,
// who may complete what. Every function that depends on the day takes `now`
// instead of reading the clock, so the screen and its tests agree on what
// "today" is.

// ── today ───────────────────────────────────────────────────────────────────

/**
 * The viewer's calendar date as a UTC-midnight instant. The core date math counts
 * whole UTC days, so an evening viewer west of Greenwich would otherwise see
 * tomorrow's date as "today".
 */
export function localToday(clock: Date): Date {
  return new Date(Date.UTC(clock.getFullYear(), clock.getMonth(), clock.getDate()))
}

export const isoDay = (day: Date): string => day.toISOString().slice(0, 10)

// ── wording ─────────────────────────────────────────────────────────────────

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "Oct 7, 2026" from a YYYY-MM-DD date (or the date part of a timestamp), whatever the viewer's time zone. */
export function formatDate(isoDate: string): string {
  return DATE_FORMAT.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`))
}

/**
 * The viewer's own calendar date for a moment in time ("Jul 1, 2026"). A completion
 * is stamped with an instant, and an evening one is already the next day in UTC.
 */
export function formatLocalDate(timestamp: string): string {
  const moment = new Date(timestamp)
  return formatDate(isoDay(new Date(Date.UTC(moment.getFullYear(), moment.getMonth(), moment.getDate()))))
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** "today", "in 12 days" or "3 days overdue". Only meaningful for a deadline that is still open. */
export function relativeDueText(dueDate: string, now: Date): string {
  const days = daysUntilDue(dueDate, now)
  if (days === 0) return 'today'
  return days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} overdue`
}

export const CADENCE_LABELS: Readonly<Record<ObligationCadence, string>> = {
  once:         'One time',
  monthly:      'Monthly',
  quarterly:    'Quarterly',
  semiannual:   'Twice a year',
  annual:       'Every year',
  biennial:     'Every 2 years',
  triennial:    'Every 3 years',
  quinquennial: 'Every 5 years',
  custom_days:  'Every set number of days',
}

export function cadenceLabel(cadence: string, cadenceDays: number | null): string {
  if (!Object.hasOwn(CADENCE_LABELS, cadence)) return cadence
  if (cadence === 'custom_days' && cadenceDays) return `Every ${plural(cadenceDays, 'day')}`
  return CADENCE_LABELS[cadence as ObligationCadence]
}

export function programLabel(program: string | null): string | null {
  if (program === null) return null
  return Object.hasOwn(ENV_PROGRAM_LABELS, program) ? ENV_PROGRAM_LABELS[program as EnvProgram] : program
}

/** A whole number typed into a field, or null when it is not one, so the API names the problem instead of the screen guessing. */
export function wholeNumberOrNull(text: string): number | null {
  const trimmed = text.trim()
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : null
}

/** What the person is told after completing a deadline: when the next one falls due, if it repeats. */
export function completionMessage(done: Pick<Deadline, 'title' | 'status' | 'next_due_at'>): string {
  return done.status === 'completed'
    ? `${done.title}: marked complete.`
    : `${done.title}: marked complete. Next due ${formatDate(done.next_due_at)}.`
}

// ── urgency ─────────────────────────────────────────────────────────────────

export const URGENCY_BUCKETS = ['overdue', 'due_soon', 'upcoming', 'completed', 'dismissed'] as const
export type UrgencyBucket = typeof URGENCY_BUCKETS[number]

export const BUCKET_LABELS: Readonly<Record<UrgencyBucket, string>> = {
  overdue:   'Overdue',
  due_soon:  'Due soon',
  upcoming:  'Upcoming',
  completed: 'Completed',
  dismissed: 'Dismissed',
}

/** Open deadlines sort by how close they are; one that is no longer open is in its own bucket. */
export function bucketOf(deadline: Deadline, now: Date): UrgencyBucket {
  if (deadline.status !== 'open') return deadline.status
  return classifyUrgency(deadline.next_due_at, now, deadline.lead_days)
}

const byDueDateThenTitle = (a: Deadline, b: Deadline) =>
  a.next_due_at.localeCompare(b.next_due_at) || a.title.localeCompare(b.title)

export interface DeadlineGroup { bucket: UrgencyBucket; label: string; deadlines: Deadline[] }

/** Deadlines grouped by urgency, most pressing group first, each group by due date. Empty groups are left out. */
export function groupByUrgency(deadlines: readonly Deadline[], now: Date): DeadlineGroup[] {
  const byBucket = new Map<UrgencyBucket, Deadline[]>()
  for (const deadline of [...deadlines].sort(byDueDateThenTitle)) {
    const bucket = bucketOf(deadline, now)
    const group = byBucket.get(bucket)
    if (group) group.push(deadline)
    else byBucket.set(bucket, [deadline])
  }
  return URGENCY_BUCKETS.flatMap(bucket => {
    const group = byBucket.get(bucket)
    return group ? [{ bucket, label: BUCKET_LABELS[bucket], deadlines: group }] : []
  })
}

/** The most pressing first; the order a day's deadlines are listed in. */
export function orderByUrgency(deadlines: readonly Deadline[], now: Date): Deadline[] {
  const rank = (deadline: Deadline) => URGENCY_BUCKETS.indexOf(bucketOf(deadline, now))
  return [...deadlines].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}

// ── filtering ───────────────────────────────────────────────────────────────

export interface DeadlineFilter {
  search: string
  /** Show only deadlines assigned to this person; null shows everyone's. */
  assignedToUserId: string | null
}

/** Every word typed must appear in the title or the regulatory reference, in any order. */
export function filterDeadlines(deadlines: readonly Deadline[], filter: DeadlineFilter): Deadline[] {
  const words = filter.search.toLowerCase().split(/\s+/).filter(Boolean)
  return deadlines.filter(deadline => {
    if (filter.assignedToUserId !== null && deadline.owner_user_id !== filter.assignedToUserId) return false
    const haystack = `${deadline.title} ${deadline.regulatory_ref ?? ''}`.toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}

// ── month grid ──────────────────────────────────────────────────────────────

/** A calendar month; `month` is 1 to 12. */
export interface MonthRef { year: number; month: number }

export const monthOf = (isoDate: string): MonthRef => ({ year: Number(isoDate.slice(0, 4)), month: Number(isoDate.slice(5, 7)) })

export function shiftMonth({ year, month }: MonthRef, months: number): MonthRef {
  const index = year * 12 + (month - 1) + months
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

export const monthTitle = ({ year, month }: MonthRef): string => MONTH_FORMAT.format(new Date(Date.UTC(year, month - 1, 1)))

export const WEEKDAYS = [
  { short: 'Sun', long: 'Sunday' }, { short: 'Mon', long: 'Monday' }, { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' }, { short: 'Thu', long: 'Thursday' }, { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
] as const

export interface CalendarDay { date: string; inMonth: boolean; deadlines: Deadline[] }

/** The month as weeks of seven days, Sunday first, each day holding the deadlines due on it. */
export function buildDeadlineMonth(month: MonthRef, deadlines: readonly Deadline[]): CalendarDay[][] {
  const placed = deadlines.map(deadline => ({ dueDate: deadline.next_due_at, deadline }))
  return buildMonthGrid(month.year, month.month, placed).map(week =>
    week.map(day => ({ date: day.date, inMonth: day.inMonth, deadlines: day.items.map(item => item.deadline) })),
  )
}

export const MAX_CHIPS_PER_DAY = 3

export interface DayChips { shown: Deadline[]; overflow: number }

/** The deadlines a day cell has room to show, most pressing first, and how many more it holds. */
export function chipsForDay(deadlines: readonly Deadline[], now: Date, max: number = MAX_CHIPS_PER_DAY): DayChips {
  const ordered = orderByUrgency(deadlines, now)
  return { shown: ordered.slice(0, max), overflow: Math.max(0, ordered.length - max) }
}

// ── who, where, what kind ───────────────────────────────────────────────────

/** A deadline carries only its owner's id; an id the screen could not resolve to a name is never shown. */
export function ownerLabel(ownerUserId: string | null, names: ReadonlyMap<string, string>): string {
  if (!ownerUserId) return 'Unassigned'
  return names.get(ownerUserId) ?? 'Assigned'
}

export function siteLabel(facilityId: string | null, names: ReadonlyMap<string, string>): string {
  if (facilityId === null) return 'All sites'
  return names.get(facilityId) ?? 'Another site'
}

export type DeadlineOrigin = 'library' | 'custom' | 'permit_renewal'

export const ORIGIN_LABELS: Readonly<Record<DeadlineOrigin, string>> = {
  library:        'Library',
  custom:         'Custom',
  permit_renewal: 'Permit renewal',
}

// Mirrors renewalLibraryKey in lib/environmental/permitSync.ts, which is server code.
const PERMIT_RENEWAL_PREFIX = 'permit-renewal:'

export function originOf(deadline: Deadline): DeadlineOrigin {
  if (deadline.library_key?.startsWith(PERMIT_RENEWAL_PREFIX)) return 'permit_renewal'
  return deadline.source === 'library' ? 'library' : 'custom'
}

// ── what a person may do ────────────────────────────────────────────────────

export interface Actor { canAdmin: boolean; userId: string | null }

/** The complete endpoint's rule: an admin, or the person the deadline is assigned to. */
export function canCompleteDeadline(deadline: Deadline, actor: Actor): boolean {
  if (deadline.status !== 'open') return false
  return actor.canAdmin || (actor.userId !== null && deadline.owner_user_id === actor.userId)
}

/** Library deadline id to the checklist that completes it, for the jurisdiction that governs a site. */
export function checklistKeysFor(state: string | null): ReadonlyMap<string, string> {
  const keys = new Map<string, string>()
  for (const obligation of libraryForState(state).library.obligations) {
    if (obligation.checklistTemplateId) keys.set(obligation.id, obligation.checklistTemplateId)
  }
  return keys
}

/** Where to run the checklist that completes this deadline, or null when it has none or is no longer open. */
export function checklistHref(deadline: Deadline, checklistKeys: ReadonlyMap<string, string>): string | null {
  const key = deadline.library_key ? checklistKeys.get(deadline.library_key) : undefined
  if (!key || deadline.status !== 'open') return null
  return `/environmental/compliance/checklists?start=${encodeURIComponent(key)}&obligation=${encodeURIComponent(deadline.id)}`
}
