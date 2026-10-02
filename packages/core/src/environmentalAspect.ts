// Shared logic for the ISO 14001:2015 clause-6.1.2 environmental aspects
// & impacts register. Significance uses the same deterministic criterion
// the database enforces (see migration 204): severity × likelihood on a
// 1-5 scale, "significant" once the score reaches the high band (≥ 12).
//
// Keeping the bands here (not just in SQL) lets the register UI colour
// rows and filter "significant only" without re-deriving the rule.

import type { FieldError } from './hazardousWaste'
import type { ScoringMethodDefinition } from './scoringMethod'

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

// ── Per-condition scoring (Phase 1) ───────────────────────────────────────
// Clause 6.1.2 asks for aspects to be considered under normal, abnormal and
// emergency conditions. Each condition is scored separately and keeps its
// own history; the database computes the same score in the
// environmental_aspect_score_history view (migrations 296-297).

/** The three operating conditions, in the order the register shows them (N / A / E). */
export const OPERATING_CONDITION_ORDER: readonly AspectOperatingCondition[] = ['normal', 'abnormal', 'emergency']

export interface AspectScore {
  score: number
  significant: boolean
}

/**
 * Score one operating condition of an aspect under a scoring method.
 * Mirrors public.ms_method_score(): a matrix cell when the method has a
 * matrix, otherwise severity × likelihood; significant at or above the
 * method's threshold.
 *
 * Precondition: 1 <= severity <= method.severityLevels and
 * 1 <= likelihood <= method.likelihoodLevels. validateAspectScoreInput
 * enforces that at the boundary.
 */
export function scoreAspect(severity: number, likelihood: number, method: ScoringMethodDefinition): AspectScore {
  const score = method.matrix?.[severity - 1]?.[likelihood - 1] ?? severity * likelihood
  return { score, significant: score >= method.significanceThreshold }
}

/** Which operating conditions have at least one score, in N / A / E order. */
export function aspectCompleteness(
  scores: readonly { operatingCondition: AspectOperatingCondition }[],
): { covered: AspectOperatingCondition[]; missing: AspectOperatingCondition[] } {
  const scored = new Set(scores.map(s => s.operatingCondition))
  return {
    covered: OPERATING_CONDITION_ORDER.filter(c => scored.has(c)),
    missing: OPERATING_CONDITION_ORDER.filter(c => !scored.has(c)),
  }
}

/** True when `a` is the more recent score: later scoredAt, then the higher id, matching the current-scores view's ordering. */
function isMoreRecent(a: { scoredAt: string; id: string }, b: { scoredAt: string; id: string }): boolean {
  const byTime = Date.parse(a.scoredAt) - Date.parse(b.scoredAt)
  if (byTime !== 0) return byTime > 0
  if (a.scoredAt !== b.scoredAt) return a.scoredAt > b.scoredAt
  return a.id > b.id
}

/** The latest score for each operating condition, as the environmental_aspect_current_scores view selects it. */
export function currentScoresByCondition<T extends { id: string; operatingCondition: AspectOperatingCondition; scoredAt: string }>(
  scores: readonly T[],
): Partial<Record<AspectOperatingCondition, T>> {
  const latest: Partial<Record<AspectOperatingCondition, T>> = {}
  for (const score of scores) {
    const current = latest[score.operatingCondition]
    if (!current || isMoreRecent(score, current)) latest[score.operatingCondition] = score
  }
  return latest
}

export interface AspectInput {
  activity:         string
  aspect:           string
  impact:           string
  processArea:      string
  lifeCycleStage:   AspectLifeCycleStage
  flow:             AspectFlow | null
  status:           AspectStatus
  controls:         string | null
  notes:            string | null
  /** Where the aspect came from: a chemical, a waste stream, an incident. Free text, no cross-module key. */
  sourceReference:  string | null
}

const ASPECT_TEXT_LIMITS = {
  activity: 500, aspect: 500, impact: 2000, processArea: 120, controls: 4000, notes: 4000, sourceReference: 300,
} as const

function requireText(errors: FieldError[], field: keyof typeof ASPECT_TEXT_LIMITS, value: string) {
  if (value.trim().length === 0) errors.push({ field, message: 'is required' })
  else if (value.length > ASPECT_TEXT_LIMITS[field]) errors.push({ field, message: `must be at most ${ASPECT_TEXT_LIMITS[field]} characters` })
}

function limitText(errors: FieldError[], field: keyof typeof ASPECT_TEXT_LIMITS, value: string | null) {
  if (value !== null && value.length > ASPECT_TEXT_LIMITS[field]) {
    errors.push({ field, message: `must be at most ${ASPECT_TEXT_LIMITS[field]} characters` })
  }
}

/** Validate a trimmed aspect for create or update. Empty means acceptable. */
export function validateAspectInput(input: AspectInput): FieldError[] {
  const errors: FieldError[] = []
  requireText(errors, 'activity', input.activity)
  requireText(errors, 'aspect', input.aspect)
  requireText(errors, 'impact', input.impact)
  requireText(errors, 'processArea', input.processArea)
  limitText(errors, 'controls', input.controls)
  limitText(errors, 'notes', input.notes)
  limitText(errors, 'sourceReference', input.sourceReference)
  if (!ASPECT_LIFE_CYCLE_STAGES.some(s => s.value === input.lifeCycleStage)) {
    errors.push({ field: 'lifeCycleStage', message: 'is not a recognised life-cycle stage' })
  }
  if (input.flow !== null && input.flow !== 'input' && input.flow !== 'output') {
    errors.push({ field: 'flow', message: 'must be input, output, or empty' })
  }
  if (!ASPECT_STATUSES.some(s => s.value === input.status)) {
    errors.push({ field: 'status', message: 'is not a recognised status' })
  }
  return errors
}

export interface AspectScoreInput {
  operatingCondition: AspectOperatingCondition
  severity:           number
  likelihood:         number
  rationale:          string
}

const RATIONALE_MAX = 2000

/** Validate one condition's score against the method's scale. Empty means acceptable. */
export function validateAspectScoreInput(input: AspectScoreInput, method: ScoringMethodDefinition): FieldError[] {
  const errors: FieldError[] = []
  if (!OPERATING_CONDITION_ORDER.includes(input.operatingCondition)) {
    errors.push({ field: 'operatingCondition', message: 'must be normal, abnormal, or emergency' })
  }
  if (!Number.isInteger(input.severity) || input.severity < 1 || input.severity > method.severityLevels) {
    errors.push({ field: 'severity', message: `must be a whole number from 1 to ${method.severityLevels}` })
  }
  if (!Number.isInteger(input.likelihood) || input.likelihood < 1 || input.likelihood > method.likelihoodLevels) {
    errors.push({ field: 'likelihood', message: `must be a whole number from 1 to ${method.likelihoodLevels}` })
  }
  if (input.rationale.trim().length === 0) errors.push({ field: 'rationale', message: 'is required: say why this score' })
  else if (input.rationale.length > RATIONALE_MAX) errors.push({ field: 'rationale', message: `must be at most ${RATIONALE_MAX} characters` })
  return errors
}
