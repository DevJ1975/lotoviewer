// BBS v2 metrics — pure helpers. The DB-bound aggregator lives in the
// web app under apps/web/lib (when we need it); these functions only
// take a list of rows and a clock.
//
// The headline metric is the safe-to-unsafe ratio:
//
//   ratio = safe_behavior_count / (unsafe_act_count + unsafe_condition_count)
//
// Industry thresholds the EHS community has converged on:
//
//   ratio < 2:1     red    — too few safe observations; culture
//                            issue, observers may be focusing only on
//                            problems
//   2 ≤ ratio < 4   yellow — coaching catching up but not yet leading
//   ratio ≥ 4:1     green  — healthy ratio
//
// We deliberately do NOT advise on the optimal ratio — that's a tenant
// + industry question. We surface the band so the dashboard can show
// the right colour.

export type ObservationCategory =
  | 'safe_behavior'
  | 'unsafe_act'
  | 'unsafe_condition'

// Structured safe-behavior checklist (WLS BBS practice). The catalog is
// a small, stable, app-owned enum — observations persist only the keys
// (as text[]), so labels and ordering can change here without a
// migration. Keep these keys in sync with the text[] column written by
// /bbs/observe.
export type BehaviorTag =
  | 'ppe'
  | 'line_of_fire'
  | 'tools_equipment'
  | 'procedures'
  | 'housekeeping'
  | 'ergonomics'

export const BEHAVIOR_TAG_CATALOG: { key: BehaviorTag; label: string }[] = [
  { key: 'ppe',             label: 'PPE' },
  { key: 'line_of_fire',    label: 'Body position / line of fire' },
  { key: 'tools_equipment', label: 'Tools & equipment' },
  { key: 'procedures',      label: 'Procedures' },
  { key: 'housekeeping',    label: 'Housekeeping' },
  { key: 'ergonomics',      label: 'Ergonomics' },
]

export interface BbsObservationV2Row {
  id:                      string
  category:                ObservationCategory
  severity?:               'minor' | 'major' | 'critical'
  follow_up_required?:     boolean
  follow_up_completed_at?: string | null
  feedback_given_at?:      string | null
  // Concept additions (migration 233). Optional so existing callers and
  // fixtures stay valid.
  behavior_tags?:             string[] | null
  recognized?:                boolean
  rapid_review_required?:     boolean
  rapid_review_completed_at?: string | null
  action_team_id?:            string | null
  created_at:              string
}

export interface BbsObservationsV2Summary {
  total:                       number
  safeBehaviorCount:           number
  unsafeActCount:              number
  unsafeConditionCount:        number
  /** Total unsafe = act + condition. The ratio's denominator. */
  unsafeCount:                 number
  /** safe / unsafe. Null when unsafe = 0 (the ratio is undefined). */
  safeToUnsafeRatio:           number | null
  /** Observations where follow_up_required = true and follow_up_completed_at is null. */
  followUpsDue:                number
  /** Total observations with feedback_given_at populated. */
  feedbackDelivered:           number
  /** Safe behaviors flagged for recognition. */
  recognizedCount:             number
  /** Observations where rapid_review_required = true and rapid_review_completed_at is null. */
  rapidReviewsDue:             number
}

export type BbsRatioBand = 'red' | 'yellow' | 'green'

/**
 * Reduce a list of v2 observations into the dashboard counts. Does
 * not filter by window — the caller passes the rows it wants summed.
 */
export function summarizeObservations(rows: readonly BbsObservationV2Row[]): BbsObservationsV2Summary {
  let safeBehaviorCount    = 0
  let unsafeActCount       = 0
  let unsafeConditionCount = 0
  let followUpsDue         = 0
  let feedbackDelivered    = 0
  let recognizedCount      = 0
  let rapidReviewsDue      = 0

  for (const r of rows) {
    if (r.category === 'safe_behavior')      safeBehaviorCount++
    else if (r.category === 'unsafe_act')    unsafeActCount++
    else if (r.category === 'unsafe_condition') unsafeConditionCount++

    if (r.follow_up_required && !r.follow_up_completed_at) followUpsDue++
    if (r.feedback_given_at) feedbackDelivered++
    if (r.recognized) recognizedCount++
    if (r.rapid_review_required && !r.rapid_review_completed_at) rapidReviewsDue++
  }

  const unsafeCount = unsafeActCount + unsafeConditionCount
  const safeToUnsafeRatio = unsafeCount === 0 ? null : safeBehaviorCount / unsafeCount

  return {
    total: rows.length,
    safeBehaviorCount,
    unsafeActCount,
    unsafeConditionCount,
    unsafeCount,
    safeToUnsafeRatio,
    followUpsDue,
    feedbackDelivered,
    recognizedCount,
    rapidReviewsDue,
  }
}

/**
 * Bucket a safe-to-unsafe ratio into red / yellow / green per the
 * industry-standard thresholds. Returns 'red' for an undefined ratio
 * (no unsafe and no safe = nothing to report; no unsafe with safe = a
 * suspicious all-safe pattern that deserves attention). Returns
 * 'green' only when there is at least one observation total AND the
 * ratio is at least 4:1.
 *
 * Fail-safe: any unexpected input (NaN, negative) returns 'red'.
 */
export function bandRatio(ratio: number | null | undefined): BbsRatioBand {
  if (ratio == null) return 'red'
  if (!Number.isFinite(ratio) || ratio < 0) return 'red'
  if (ratio < 2)  return 'red'
  if (ratio < 4)  return 'yellow'
  return 'green'
}

export const RATIO_BAND_LABEL: Record<BbsRatioBand, string> = {
  red:    'Too few safe observations',
  yellow: 'Coaching catching up',
  green:  'Healthy coaching ratio',
}

/**
 * Count observations per behavior-checklist tag. Seeds every catalog key
 * at zero so the dashboard can render a stable row order, and ignores any
 * tag not in the catalog (defensive — the form only emits catalog keys,
 * but stored rows may predate a catalog change).
 */
export function tallyBehaviorTags(
  rows: readonly BbsObservationV2Row[],
): Record<BehaviorTag, number> {
  const tally = Object.fromEntries(
    BEHAVIOR_TAG_CATALOG.map(t => [t.key, 0]),
  ) as Record<BehaviorTag, number>

  for (const r of rows) {
    for (const tag of r.behavior_tags ?? []) {
      if (tag in tally) tally[tag as BehaviorTag]++
    }
  }
  return tally
}

/**
 * Count "Hot Seat" rapid reviews against a 24h SLA. `due` is any review
 * required but not yet completed; `overdue` is the subset whose age
 * exceeds the SLA. Clock is injected so the helper stays pure.
 *
 * Fail-safe: an unparseable created_at counts as due but never overdue —
 * we don't escalate on bad data.
 */
export function countRapidReviews(
  rows: readonly BbsObservationV2Row[],
  now: Date,
  slaHours = 24,
): { due: number; overdue: number } {
  const slaMs = slaHours * 3_600_000
  let due = 0
  let overdue = 0

  for (const r of rows) {
    if (!r.rapid_review_required || r.rapid_review_completed_at) continue
    due++
    const createdMs = Date.parse(r.created_at)
    if (Number.isFinite(createdMs) && now.getTime() - createdMs > slaMs) overdue++
  }
  return { due, overdue }
}
