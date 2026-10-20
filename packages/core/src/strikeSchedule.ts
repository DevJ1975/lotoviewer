// STRIKE scheduling: when training is due, when it repeats, and when each
// module of a curriculum is released. Pure date math, no I/O, so the cron,
// the admin preview and the learner view all agree.

export const STRIKE_RECURRENCE_FREQS = ['monthly', 'quarterly', 'semiannual', 'annual', 'interval'] as const
export type StrikeRecurrenceFreq = typeof STRIKE_RECURRENCE_FREQS[number]

export const STRIKE_TRIGGER_KINDS = ['manual', 'schedule', 'permit', 'pre_job', 'onboarding'] as const
export type StrikeTriggerKind = typeof STRIKE_TRIGGER_KINDS[number]

export interface StrikeRecurrenceRule {
  freq: StrikeRecurrenceFreq
  /** Only for freq = 'interval'. */
  intervalDays: number | null
  /** Days after the due date that the assignment stays open. */
  expiryDays: number | null
}

const MONTHS_BY_FREQ: Record<Exclude<StrikeRecurrenceFreq, 'interval'>, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

export const STRIKE_RECURRENCE_LABELS: Record<StrikeRecurrenceFreq, string> = {
  monthly: 'Every month',
  quarterly: 'Every quarter',
  semiannual: 'Every 6 months',
  annual: 'Every year',
  interval: 'Every N days',
}

/**
 * Reads a stored recurrence_rule. Rows written before calendar frequencies
 * existed carry only `interval_days`; they keep working as 'interval'.
 */
export function parseRecurrenceRule(value: unknown): StrikeRecurrenceRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const intervalDays = positiveInt(raw.interval_days)
  const expiryDays = positiveInt(raw.expiry_days)
  const freq = typeof raw.freq === 'string' && (STRIKE_RECURRENCE_FREQS as readonly string[]).includes(raw.freq)
    ? raw.freq as StrikeRecurrenceFreq
    : intervalDays ? 'interval' : null
  if (!freq) return null
  if (freq === 'interval' && !intervalDays) return null
  return { freq, intervalDays: freq === 'interval' ? intervalDays : null, expiryDays }
}

export function serializeRecurrenceRule(rule: StrikeRecurrenceRule): Record<string, unknown> {
  return {
    freq: rule.freq,
    ...(rule.freq === 'interval' ? { interval_days: rule.intervalDays } : {}),
    ...(rule.expiryDays ? { expiry_days: rule.expiryDays } : {}),
  }
}

/**
 * The next due date strictly after `now`, stepping from the previous due
 * date so a schedule keeps its anchor ("the 15th of each quarter") instead
 * of drifting to whenever the cron happened to run. Calendar steps clamp to
 * the last day of a short month (Jan 31 → Feb 28/29 → Mar 31).
 */
export function nextDueDate(rule: StrikeRecurrenceRule, previousDue: Date, now: Date): Date {
  let step = 1
  let candidate = advance(rule, previousDue, step)
  while (candidate.getTime() <= now.getTime()) {
    step += 1
    candidate = advance(rule, previousDue, step)
  }
  return candidate
}

function advance(rule: StrikeRecurrenceRule, from: Date, steps: number): Date {
  if (rule.freq === 'interval') return new Date(from.getTime() + steps * (rule.intervalDays as number) * 86_400_000)
  return addMonthsClamped(from, MONTHS_BY_FREQ[rule.freq] * steps)
}

export function addMonthsClamped(from: Date, months: number): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(
    year, month, Math.min(from.getUTCDate(), lastDay),
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds(),
  ))
}

export function expiryFor(rule: StrikeRecurrenceRule, due: Date): Date | null {
  return rule.expiryDays ? new Date(due.getTime() + rule.expiryDays * 86_400_000) : null
}

// ── Curricula (admin-controlled drip release) ───────────────────────────

export interface StrikeCurriculumItem {
  moduleId: string
  sortOrder: number
  releaseOffsetDays: number
  dueAfterDays: number
}

export interface StrikeScheduledRelease {
  moduleId: string
  startsAt: Date
  dueAt: Date
}

/** Release and due dates for every module in a curriculum enrolled at `startsAt`. */
export function curriculumSchedule(items: StrikeCurriculumItem[], startsAt: Date): StrikeScheduledRelease[] {
  return [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(item => {
      const release = new Date(startsAt.getTime() + Math.max(0, item.releaseOffsetDays) * 86_400_000)
      return {
        moduleId: item.moduleId,
        startsAt: release,
        dueAt: new Date(release.getTime() + Math.max(1, item.dueAfterDays) * 86_400_000),
      }
    })
}

/** A scheduled assignment stays hidden from learners until its release date. */
export function isAssignmentReleased(startsAt: string | Date | null | undefined, now: Date): boolean {
  if (!startsAt) return true
  const time = new Date(startsAt).getTime()
  return !Number.isFinite(time) || time <= now.getTime()
}

export type StrikeAssignmentStanding = 'upcoming' | 'open' | 'due_soon' | 'overdue' | 'complete'

const DUE_SOON_MS = 3 * 86_400_000

export function assignmentStanding(
  input: { startsAt?: string | null; dueAt?: string | null; completed: boolean },
  now: Date,
): StrikeAssignmentStanding {
  if (input.completed) return 'complete'
  if (!isAssignmentReleased(input.startsAt, now)) return 'upcoming'
  if (!input.dueAt) return 'open'
  const due = new Date(input.dueAt).getTime()
  if (due < now.getTime()) return 'overdue'
  return due - now.getTime() <= DUE_SOON_MS ? 'due_soon' : 'open'
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

export type StrikeReminderKind = 'due_soon' | 'overdue'

const DAY_MS = 86_400_000

/**
 * Which reminder, if any, a daily run should send for an open assignment.
 * Deliberately sparse so people read them: three days and one day before
 * the due date, then the day after and weekly while overdue.
 */
export function strikeReminderFor(dueAt: string | Date | null | undefined, now: Date): StrikeReminderKind | null {
  if (!dueAt) return null
  const due = new Date(dueAt).getTime()
  if (!Number.isFinite(due)) return null
  const daysUntil = Math.ceil((due - now.getTime()) / DAY_MS)
  if (daysUntil === 3 || daysUntil === 1) return 'due_soon'
  const daysOverdue = Math.floor((now.getTime() - due) / DAY_MS)
  if (daysOverdue >= 1 && (daysOverdue - 1) % 7 === 0) return 'overdue'
  return null
}
