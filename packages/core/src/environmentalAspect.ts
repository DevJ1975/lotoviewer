// Shared logic for the ISO 14001:2015 clause-6.1.2 environmental aspects
// & impacts register. Significance uses the same deterministic criterion
// the database enforces (see migration 204): severity × likelihood on a
// 1-5 scale, "significant" once the score reaches the high band (≥ 12).
//
// Keeping the bands here (not just in SQL) lets the register UI colour
// rows and filter "significant only" without re-deriving the rule.

export type AspectLifeCycleStage =
  | 'raw_material'
  | 'manufacturing'
  | 'operation'
  | 'transport'
  | 'use'
  | 'end_of_life'

export type AspectOperatingCondition = 'normal' | 'abnormal' | 'emergency'
export type AspectFlow = 'input' | 'output'
export type AspectStatus = 'identified' | 'controlled' | 'monitored' | 'closed'
export type AspectSignificanceBand = 'low' | 'moderate' | 'high' | 'extreme'

/** Score at/above which an aspect is "significant" (drives objectives +
 * operational controls). Mirrors the generated column in migration 204. */
export const ASPECT_SIGNIFICANCE_THRESHOLD = 12

/** severity × likelihood, each on a 1-5 scale → 1..25. */
export function aspectSignificanceScore(severity: number, likelihood: number): number {
  return severity * likelihood
}

/** Band the 1..25 score the same way the risk matrix bands its grid, so
 * the two surfaces share visual language. */
export function aspectSignificanceBand(score: number): AspectSignificanceBand {
  if (score <= 5) return 'low'
  if (score <= 11) return 'moderate'
  if (score <= 19) return 'high'
  return 'extreme'
}

/** True when the score reaches the documented significance threshold. */
export function isAspectSignificant(score: number): boolean {
  return score >= ASPECT_SIGNIFICANCE_THRESHOLD
}

// Option lists for the register form's selects (label + value).
export const ASPECT_LIFE_CYCLE_STAGES: readonly { value: AspectLifeCycleStage; label: string }[] = [
  { value: 'raw_material',  label: 'Raw material' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'operation',     label: 'Operation' },
  { value: 'transport',     label: 'Transport' },
  { value: 'use',           label: 'Use' },
  { value: 'end_of_life',   label: 'End of life' },
]

export const ASPECT_OPERATING_CONDITIONS: readonly { value: AspectOperatingCondition; label: string }[] = [
  { value: 'normal',    label: 'Normal' },
  { value: 'abnormal',  label: 'Abnormal' },
  { value: 'emergency', label: 'Emergency' },
]

export const ASPECT_STATUSES: readonly { value: AspectStatus; label: string }[] = [
  { value: 'identified', label: 'Identified' },
  { value: 'controlled', label: 'Controlled' },
  { value: 'monitored',  label: 'Monitored' },
  { value: 'closed',     label: 'Closed' },
]
