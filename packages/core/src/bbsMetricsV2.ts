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

export interface BbsObservationV2Row {
  id:                      string
  category:                ObservationCategory
  severity?:               'minor' | 'major' | 'critical'
  follow_up_required?:     boolean
  follow_up_completed_at?: string | null
  feedback_given_at?:      string | null
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

  for (const r of rows) {
    if (r.category === 'safe_behavior')      safeBehaviorCount++
    else if (r.category === 'unsafe_act')    unsafeActCount++
    else if (r.category === 'unsafe_condition') unsafeConditionCount++

    if (r.follow_up_required && !r.follow_up_completed_at) followUpsDue++
    if (r.feedback_given_at) feedbackDelivered++
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
