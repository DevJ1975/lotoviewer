// Predictive escalation helper.
//
// The intake severity classification is often under-stated:
//   * a worker downplays
//   * the full impact is not yet known
//
// Running a model over the description and comparing its predicted
// severity to the reporter's classification surfaces those cases. The
// classifier here is pure — given the current severity and a
// prediction blob, return true when we should escalate.
//
// The severity axis is fixed by 29 CFR 1904.7 + OSHA recordkeeping
// conventions; the ordering below reflects "most serious first" so
// `>` is the regulator's meaning of "more serious", not the
// alphabetic one. The "catastrophic" tier is platform-specific —
// multiple fatalities, major facility damage, regulatory shutdown.

export type IncidentSeverity =
  | 'catastrophic'
  | 'fatality'
  | 'lost_time'
  | 'medical'
  | 'first_aid'
  | 'none'

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  catastrophic: 5,
  fatality:     4,
  lost_time:    3,
  medical:      2,
  first_aid:    1,
  none:         0,
}

export interface SeverityPrediction {
  predicted_severity: IncidentSeverity
  confidence:         number             // [0, 1]
}

export const ESCALATION_CONFIDENCE_THRESHOLD = 0.7

/**
 * True when the prediction recommends escalation:
 *   1. predicted severity is strictly higher than current
 *   2. confidence is at or above the threshold (default 0.7)
 *
 * Threshold rationale: 0.7 is the sweet spot between "useful signal"
 * and "false-positive noise" observed in pilots — high enough to
 * trust a Yes from Haiku, low enough to catch the under-classified
 * cases the operator cares about.
 */
export function shouldEscalate(
  currentSeverity: IncidentSeverity,
  prediction:      SeverityPrediction,
  confidenceThreshold: number = ESCALATION_CONFIDENCE_THRESHOLD,
): boolean {
  if (prediction.confidence < confidenceThreshold) return false
  return SEVERITY_RANK[prediction.predicted_severity] > SEVERITY_RANK[currentSeverity]
}

/**
 * Strict-order comparator: returns negative when `a` is less serious
 * than `b`, positive when more serious, 0 when equal. Provided so
 * callers can sort lists of predictions without re-deriving the rank.
 */
export function compareSeverity(a: IncidentSeverity, b: IncidentSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b]
}

export const SEVERITY_RANK_ORDER: readonly IncidentSeverity[] = [
  'catastrophic', 'fatality', 'lost_time', 'medical', 'first_aid', 'none',
]
