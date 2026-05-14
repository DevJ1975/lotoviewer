// Compliance Calendar + Legal Registry — pure domain logic.
//
// The persisted obligation row carries the *inputs* to status: a due
// date, an optional last_completed_at, an optional snoozed_until, and a
// not_applicable flag. The status itself is *derived* at query time
// from those inputs and "today". This avoids the persisted-status
// drift problem we hit on incidents (a stale `status` column outliving
// the dates that should drive it).
//
// All date math here is performed on calendar dates only (no time
// component) using YYYY-MM-DD strings. The DB stores `next_due_date`
// as `date` (no zone); we treat "today" as the caller-supplied UTC
// date so server + client agree on transitions.

export const OBLIGATION_CATEGORIES = [
  'training',
  'inspection',
  'reporting',
  'audit',
  'permit_renewal',
  'drill',
  'submission',
  'review',
  'other',
] as const
export type ObligationCategory = (typeof OBLIGATION_CATEGORIES)[number]

export const OBLIGATION_FREQUENCIES = [
  'one_time',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'biennial',
  'custom_days',
] as const
export type ObligationFrequency = (typeof OBLIGATION_FREQUENCIES)[number]

export const OBLIGATION_STATUSES = [
  'completed',       // one_time + already completed
  'not_applicable',
  'snoozed',
  'overdue',
  'due_soon',
  'upcoming',
] as const
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number]

export const LEGAL_STATUSES = ['active', 'under_review', 'superseded', 'not_applicable'] as const
export type LegalStatus = (typeof LEGAL_STATUSES)[number]

export const REVIEW_FREQUENCIES = [
  'one_time',
  'quarterly',
  'semiannual',
  'annual',
  'biennial',
  'triennial',
] as const
export type ReviewFrequency = (typeof REVIEW_FREQUENCIES)[number]

// ─── Status derivation ────────────────────────────────────────────────

export interface ObligationStatusInput {
  frequency:         ObligationFrequency
  nextDueDate:       string                 // YYYY-MM-DD
  leadDays:          number
  lastCompletedAt:   string | null          // ISO timestamp
  snoozedUntil:      string | null          // YYYY-MM-DD
  notApplicable:     boolean
}

/**
 * Pure status derivation. `today` is YYYY-MM-DD in the caller's frame
 * of reference (server uses UTC, client uses local; UI shows both, the
 * single-source-of-truth is the server's UTC view).
 *
 * Precedence (top wins):
 *   1. not_applicable          → 'not_applicable'
 *   2. one_time + last_completed → 'completed'
 *   3. snoozed_until > today   → 'snoozed'
 *   4. next_due < today        → 'overdue'
 *   5. next_due <= today + leadDays → 'due_soon'
 *   6. else                    → 'upcoming'
 */
export function deriveObligationStatus(
  input: ObligationStatusInput,
  today: string,
): ObligationStatus {
  if (input.notApplicable) return 'not_applicable'
  if (input.frequency === 'one_time' && input.lastCompletedAt) return 'completed'

  if (input.snoozedUntil && input.snoozedUntil > today) return 'snoozed'
  if (input.nextDueDate < today) return 'overdue'

  const dueSoonCutoff = addDays(today, input.leadDays)
  if (input.nextDueDate <= dueSoonCutoff) return 'due_soon'

  return 'upcoming'
}

// ─── Cadence advancement ──────────────────────────────────────────────

const FREQUENCY_DAYS: Partial<Record<ObligationFrequency, number>> = {
  daily:      1,
  weekly:     7,
  quarterly:  91,    // 13 weeks. Calendar quarters aren't uniform; the
                     // user can edit next_due manually if they need a
                     // specific calendar quarter.
  semiannual: 183,
  annual:     365,
  biennial:   730,
}

/**
 * Advance `next_due_date` after a completion. For monthly we use real
 * calendar-month math (UTC) so anniversaries land cleanly; other
 * cadences add a fixed number of days from the *completion* date.
 *
 * Returns null for one_time (caller should not advance — the
 * obligation is done).
 */
export function advanceNextDueDate(
  frequency:     ObligationFrequency,
  completionISO: string,             // ISO timestamp of the completion
  frequencyDays: number | null,
): string | null {
  if (frequency === 'one_time') return null

  const completionDate = toDateString(completionISO)

  if (frequency === 'monthly') return addMonths(completionDate, 1)
  if (frequency === 'custom_days') {
    if (!frequencyDays || frequencyDays <= 0) return addDays(completionDate, 30)
    return addDays(completionDate, frequencyDays)
  }

  const days = FREQUENCY_DAYS[frequency]
  if (!days) return addDays(completionDate, 30)
  return addDays(completionDate, days)
}

// ─── Date helpers — UTC-only, calendar-date math ──────────────────────
// Kept inline (rather than importing date-fns) so the core package
// stays dependency-free for the upcoming React Native build.

export function toDateString(iso: string): string {
  // Truncate ISO to YYYY-MM-DD in UTC. Works for both pure dates and
  // full timestamps; throws on garbage so calling routes don't store
  // bad data.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${iso}`)
  return d.toISOString().slice(0, 10)
}

export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDateOnly(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function addMonths(dateStr: string, months: number): string {
  const d = parseDateOnly(dateStr)
  const targetMonth = d.getUTCMonth() + months
  const targetDay = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(targetMonth)
  // Clamp to month length: Jan 31 + 1 month → Feb 28/29, not Mar 3.
  const lastDay = lastDayOfMonth(d.getUTCFullYear(), d.getUTCMonth())
  d.setUTCDate(Math.min(targetDay, lastDay))
  return d.toISOString().slice(0, 10)
}

function lastDayOfMonth(year: number, monthZeroIndexed: number): number {
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate()
}

function parseDateOnly(dateStr: string): Date {
  // Force UTC interpretation. `new Date('2026-05-13')` is UTC midnight
  // but `new Date('2026-05-13T00:00:00')` is *local* midnight on Node.
  // Construct via Date.UTC to avoid that footgun.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`)
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

// ─── Labels ───────────────────────────────────────────────────────────

export const CATEGORY_LABEL: Record<ObligationCategory, string> = {
  training:        'Training',
  inspection:      'Inspection',
  reporting:       'Reporting',
  audit:           'Audit',
  permit_renewal:  'Permit renewal',
  drill:           'Drill',
  submission:      'Regulatory submission',
  review:          'Review',
  other:           'Other',
}

export const FREQUENCY_LABEL: Record<ObligationFrequency, string> = {
  one_time:    'One time',
  daily:       'Daily',
  weekly:      'Weekly',
  monthly:     'Monthly',
  quarterly:   'Quarterly',
  semiannual:  'Semi-annual',
  annual:      'Annual',
  biennial:    'Every 2 years',
  custom_days: 'Custom (days)',
}

export const STATUS_LABEL: Record<ObligationStatus, string> = {
  completed:      'Completed',
  not_applicable: 'Not applicable',
  snoozed:        'Snoozed',
  overdue:        'Overdue',
  due_soon:       'Due soon',
  upcoming:       'Upcoming',
}

// Status → Tailwind color band (foreground / pill). The matching
// className strings live in apps/web; we surface only a semantic
// token here.
export const STATUS_TONE: Record<ObligationStatus, 'rose' | 'amber' | 'sky' | 'slate' | 'emerald'> = {
  overdue:        'rose',
  due_soon:       'amber',
  upcoming:       'sky',
  snoozed:        'slate',
  not_applicable: 'slate',
  completed:      'emerald',
}
