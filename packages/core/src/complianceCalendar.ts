// Pure logic for the compliance obligations calendar. No I/O, no DOM.
//
// - classifyUrgency: where a due date sits relative to "now".
// - advanceDueDate: the next due date after an obligation is completed.
// - nextAnnualOccurrence: next calendar occurrence of a month/day anchor.
// - SYSTEM_OBLIGATIONS + planSystemSeeds: the well-known regulatory
//   deadlines we seed per tenant (gated by which modules a tenant has).

export type ObligationCadence =
  | 'once' | 'monthly' | 'quarterly' | 'semiannual'
  | 'annual' | 'biennial' | 'triennial' | 'quinquennial' | 'custom_days'

export type ObligationUrgency = 'overdue' | 'due_soon' | 'upcoming'

export const DUE_SOON_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

// Parse a YYYY-MM-DD (date-only) value as a UTC calendar day. Accepts a Date
// passthrough for convenience.
function toUtcDay(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  }
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y!, (m! - 1), d!))
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Whole calendar days from `now` until `dueDate` (negative = past due). */
export function daysUntilDue(dueDate: string | Date, now: Date = new Date()): number {
  const due = toUtcDay(dueDate).getTime()
  const today = toUtcDay(now).getTime()
  return Math.round((due - today) / DAY_MS)
}

export function classifyUrgency(
  dueDate: string | Date,
  now: Date = new Date(),
  dueSoonDays: number = DUE_SOON_DAYS,
): ObligationUrgency {
  const days = daysUntilDue(dueDate, now)
  if (days < 0) return 'overdue'
  if (days <= dueSoonDays) return 'due_soon'
  return 'upcoming'
}

const MONTHS_BY_CADENCE: Partial<Record<ObligationCadence, number>> = {
  monthly: 1, quarterly: 3, semiannual: 6, annual: 12,
  biennial: 24, triennial: 36, quinquennial: 60,
}

/**
 * The next due date after completing an obligation. `once` obligations don't
 * recur (the caller should mark them completed instead); returns the input
 * unchanged for `once`.
 */
export function advanceDueDate(
  current: string | Date,
  cadence: ObligationCadence,
  cadenceDays?: number | null,
): string {
  const base = toUtcDay(current)
  if (cadence === 'once') return fmt(base)
  if (cadence === 'custom_days') {
    const n = cadenceDays && cadenceDays > 0 ? cadenceDays : 1
    return fmt(new Date(base.getTime() + n * DAY_MS))
  }
  const months = MONTHS_BY_CADENCE[cadence]
  if (!months) return fmt(base)
  // Anchor to the same day-of-month; JS Date normalizes overflow (e.g. Jan 31
  // + 1mo → Mar 3), which is acceptable for compliance cadences.
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()))
  return fmt(next)
}

/** Next occurrence of (month, day) on or after `from`, as YYYY-MM-DD. */
export function nextAnnualOccurrence(
  anchorMonth: number,
  anchorDay: number,
  from: Date = new Date(),
): string {
  const today = toUtcDay(from)
  const thisYear = new Date(Date.UTC(today.getUTCFullYear(), anchorMonth - 1, anchorDay))
  if (thisYear.getTime() >= today.getTime()) return fmt(thisYear)
  return fmt(new Date(Date.UTC(today.getUTCFullYear() + 1, anchorMonth - 1, anchorDay)))
}

export interface SystemObligation {
  systemKey:      string
  title:          string
  description:    string
  regulatoryRef:  string
  category:       string
  cadence:        ObligationCadence
  anchorMonth:    number
  anchorDay:      number
  /** Feature id the tenant must have enabled for this obligation to apply; null = always. */
  requiresModule: string | null
}

// Well-known annual regulatory deadlines. Kept small + concrete; obligations
// without a fixed calendar anchor (e.g. PSM 3-yr audit) are tenant-defined.
export const SYSTEM_OBLIGATIONS: SystemObligation[] = [
  {
    systemKey: 'osha-300a-post',
    title: 'Post OSHA Form 300A summary',
    description: 'Post the prior calendar year’s 300A summary where notices are customarily posted, Feb 1–Apr 30.',
    regulatoryRef: '29 CFR 1904.32',
    category: 'osha', cadence: 'annual', anchorMonth: 2, anchorDay: 1,
    requiresModule: 'incidents',
  },
  {
    systemKey: 'osha-ita-submit',
    title: 'Submit injury/illness data to OSHA ITA',
    description: 'Electronically submit Form 300A (and 300/301 for covered establishments) via the OSHA ITA.',
    regulatoryRef: '29 CFR 1904.41',
    category: 'osha', cadence: 'annual', anchorMonth: 3, anchorDay: 2,
    requiresModule: 'incidents',
  },
  {
    systemKey: 'epcra-tier-ii',
    title: 'File EPCRA Tier II report',
    description: 'Report hazardous chemical inventories to the SERC, LEPC, and local fire department.',
    regulatoryRef: '40 CFR 370',
    category: 'chemicals', cadence: 'annual', anchorMonth: 3, anchorDay: 1,
    requiresModule: 'chemicals',
  },
]

export interface SeedPlanItem {
  systemKey:     string
  title:         string
  description:   string
  regulatoryRef: string
  category:      string
  cadence:       ObligationCadence
  nextDueAt:     string
}

/**
 * Which system obligations to insert for a tenant: those whose required module
 * is enabled and that aren't already seeded.
 *
 * @param existingKeys system_keys already present for the tenant
 * @param isModuleEnabled predicate over a feature id (pass tenant module visibility)
 */
export function planSystemSeeds(
  existingKeys: ReadonlySet<string>,
  isModuleEnabled: (featureId: string) => boolean,
  now: Date = new Date(),
): SeedPlanItem[] {
  const out: SeedPlanItem[] = []
  for (const o of SYSTEM_OBLIGATIONS) {
    if (existingKeys.has(o.systemKey)) continue
    if (o.requiresModule && !isModuleEnabled(o.requiresModule)) continue
    out.push({
      systemKey: o.systemKey,
      title: o.title,
      description: o.description,
      regulatoryRef: o.regulatoryRef,
      category: o.category,
      cadence: o.cadence,
      nextDueAt: nextAnnualOccurrence(o.anchorMonth, o.anchorDay, now),
    })
  }
  return out
}
