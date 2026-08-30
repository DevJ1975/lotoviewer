// Hazard Hunt — pure types + helpers. No I/O, no DOM, no Node.
//
// A Hazard Hunt is a recurring OSHA/Cal-OSHA workplace inspection built on the
// generic inspection engine. This module holds the small amount of pure logic
// the web + mobile apps, the API routes, and the agents all share: the cadence
// vocabulary, the finding lifecycle, the severity→risk mapping used on
// escalation, and the deterministic date math the generator cron relies on.

// ── Hazard taxonomy ──────────────────────────────────────────────────────────
// The same 9 categories used by the risk register, JHA, and near-miss modules
// (ISO 45001 6.1.2.1 + Cal/OSHA T8 §3203). Mirrored here — not a new taxonomy —
// so a finding escalates to a risk with its category unchanged. Kept as a local
// const to match the per-module convention (JHA_HAZARD_CATEGORIES, etc.).
export const HAZARD_HUNT_HAZARD_CATEGORIES = [
  'physical', 'chemical', 'biological', 'mechanical', 'electrical',
  'ergonomic', 'psychosocial', 'environmental', 'radiological',
] as const
export type HazardCategory = typeof HAZARD_HUNT_HAZARD_CATEGORIES[number]

// ── Cadence ──────────────────────────────────────────────────────────────────
export const HAZARD_HUNT_CADENCES = ['daily', 'weekly', 'monthly'] as const
export type HazardHuntCadence = typeof HAZARD_HUNT_CADENCES[number]

// ── Finding lifecycle ─────────────────────────────────────────────────────────
export const HAZARD_HUNT_FINDING_STATUSES = ['open', 'in_progress', 'closed', 'escalated'] as const
export type HazardHuntFindingStatus = typeof HAZARD_HUNT_FINDING_STATUSES[number]

// A finding counts as "resolved" for the proactive EHS indicator once it is
// either closed out or promoted into the risk register.
export const HAZARD_HUNT_RESOLVED_STATUSES: readonly HazardHuntFindingStatus[] = ['closed', 'escalated']

// ── Severity hint ──────────────────────────────────────────────────────────────
export const SEVERITY_HINTS = ['low', 'moderate', 'high', 'extreme'] as const
export type SeverityHint = typeof SEVERITY_HINTS[number]

// ── Row shapes (mirror the DB columns; used by API routes + UI) ──────────────
export interface HazardHuntScheduleRow {
  id:                       string
  tenant_id:                string
  template_id:              string
  cadence:                  HazardHuntCadence
  day_of_week:              number | null
  day_of_month:             number | null
  default_assignee_user_id: string | null
  active:                   boolean
  last_generated_on:        string | null
  created_at:               string
  updated_at:               string
}

export interface HazardHuntFindingRow {
  id:              string
  tenant_id:       string
  finding_number:  string | null
  inspection_id:   string
  response_id:     string | null
  item_id:         string | null
  hazard_category: HazardCategory
  title:           string
  description:     string
  severity_hint:   SeverityHint | null
  status:          HazardHuntFindingStatus
  capa_id:         string | null
  closed_at:       string | null
  created_at:      string
  updated_at:      string
}

// ── Validators (boundary checks) ──────────────────────────────────────────────
export function isHazardHuntCadence(v: unknown): v is HazardHuntCadence {
  return typeof v === 'string' && (HAZARD_HUNT_CADENCES as readonly string[]).includes(v)
}
export function isSeverityHint(v: unknown): v is SeverityHint {
  return typeof v === 'string' && (SEVERITY_HINTS as readonly string[]).includes(v)
}
export function isHazardCategory(v: unknown): v is HazardCategory {
  return typeof v === 'string' && (HAZARD_HUNT_HAZARD_CATEGORIES as readonly string[]).includes(v)
}
export function isHazardHuntFindingStatus(v: unknown): v is HazardHuntFindingStatus {
  return typeof v === 'string' && (HAZARD_HUNT_FINDING_STATUSES as readonly string[]).includes(v)
}

// ── severity hint → inherent severity (1..5) ───────────────────────────────────
// Used when a finding is escalated to a risk. Same mapping the JHA→risk escalate
// route uses (low→2, moderate→3, high→4, extreme→5). A missing hint defaults to
// the conservative middle (3) so an un-triaged finding still escalates sanely.
const SEVERITY_HINT_TO_INHERENT: Record<SeverityHint, 1 | 2 | 3 | 4 | 5> = {
  low: 2, moderate: 3, high: 4, extreme: 5,
}
export function severityHintToInherent(hint: SeverityHint | null | undefined): 1 | 2 | 3 | 4 | 5 {
  return hint ? SEVERITY_HINT_TO_INHERENT[hint] : 3
}

// ── Cadence date math (deterministic, UTC, DST-safe) ────────────────────────────
// Dates are handled as 'YYYY-MM-DD' strings in UTC to avoid local-timezone and
// DST drift — a hazard hunt is scheduled by calendar day, not by clock instant.

const MS_PER_DAY = 86_400_000

function toUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!))
}
function fmt(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export interface CadenceAnchor {
  /** Weekly cadence fires on this weekday (0=Sunday..6=Saturday). */
  dayOfWeek?: number | null
  /** Monthly cadence fires on this day of month (1..28). */
  dayOfMonth?: number | null
}

/**
 * The first calendar date on or after `asOf` on which `cadence` is due.
 *   • daily   → `asOf` (a daily hunt is due every day).
 *   • weekly  → the next date whose weekday matches the anchor (defaults to
 *               `asOf`'s own weekday when no anchor is set).
 *   • monthly → the next date whose day-of-month matches the anchor (defaults to
 *               `asOf`'s own day-of-month). Anchors are capped at 28 upstream so
 *               every month contains the day.
 * All inputs/outputs are 'YYYY-MM-DD' UTC strings.
 */
export function nextHazardHuntDueDate(
  cadence: HazardHuntCadence,
  anchor: CadenceAnchor,
  asOf: string,
): string {
  const start = toUtcDate(asOf)

  if (cadence === 'daily') return fmt(start)

  if (cadence === 'weekly') {
    const target = anchor.dayOfWeek ?? start.getUTCDay()
    const delta = ((target - start.getUTCDay()) % 7 + 7) % 7
    return fmt(new Date(start.getTime() + delta * MS_PER_DAY))
  }

  // monthly
  const targetDom = anchor.dayOfMonth ?? start.getUTCDate()
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  if (start.getUTCDate() > targetDom) {
    // This month's occurrence already passed; roll to next month.
    month += 1
    if (month > 11) { month = 0; year += 1 }
  }
  return fmt(new Date(Date.UTC(year, month, targetDom)))
}

/**
 * Whether a run is due on `asOf` for the given cadence/anchor — i.e. today is an
 * occurrence date. The generator cron uses this together with the
 * `last_generated_on` watermark to stay idempotent.
 */
export function isHazardHuntDueOn(cadence: HazardHuntCadence, anchor: CadenceAnchor, asOf: string): boolean {
  return nextHazardHuntDueDate(cadence, anchor, asOf) === asOf
}

/**
 * Cadence adherence as a 0..1 ratio of completed to generated runs. With nothing
 * scheduled there is nothing to miss, so adherence is a vacuous 1.
 */
export function cadenceAdherence(generated: number, completed: number): number {
  if (generated <= 0) return 1
  return Math.min(1, Math.max(0, completed / generated))
}
