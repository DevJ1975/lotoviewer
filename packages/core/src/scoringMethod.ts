// A scoring method is the documented rule that turns a severity and a
// likelihood into a significance score (ISO 14001 clause 6.1.2 asks for the
// criteria to be documented). Methods are immutable once any score uses
// them, so a score row plus its method always reproduce the same answer;
// changing the rule means a new version. The database mirrors this rule in
// public.ms_method_score() (migration 296).

import type { FieldError } from './hazardousWaste'

export interface ScoringMethod {
  id: string
  severityLevels: number
  likelihoodLevels: number
  /** null = severity × likelihood; otherwise matrix[severity - 1][likelihood - 1]. */
  matrix: readonly (readonly number[])[] | null
  significanceThreshold: number
}

export type ScoringMethodDefinition = Omit<ScoringMethod, 'id'>

/** The rule migration 204 hard-coded: 5 × 5, significant at 12. Every tenant's default method starts here. */
export const DEFAULT_SCORING_METHOD: ScoringMethodDefinition = {
  severityLevels: 5,
  likelihoodLevels: 5,
  matrix: null,
  significanceThreshold: 12,
}

export const DEFAULT_SCORING_METHOD_NAME = 'Severity × likelihood (5×5)'

const MIN_LEVELS = 2
const MAX_LEVELS = 10

function isWholeNumberBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/**
 * Shape problems that would make a method score nonsensically: level counts
 * out of range, a matrix that does not match them, non-positive cells, or a
 * threshold no score can reach. Empty means the method is usable.
 */
export function validateScoringMethod(method: ScoringMethodDefinition): FieldError[] {
  const errors: FieldError[] = []
  const { severityLevels, likelihoodLevels, matrix, significanceThreshold } = method

  if (!isWholeNumberBetween(severityLevels, MIN_LEVELS, MAX_LEVELS)) {
    errors.push({ field: 'severityLevels', message: `must be a whole number from ${MIN_LEVELS} to ${MAX_LEVELS}` })
  }
  if (!isWholeNumberBetween(likelihoodLevels, MIN_LEVELS, MAX_LEVELS)) {
    errors.push({ field: 'likelihoodLevels', message: `must be a whole number from ${MIN_LEVELS} to ${MAX_LEVELS}` })
  }
  if (!Number.isInteger(significanceThreshold) || significanceThreshold < 1) {
    errors.push({ field: 'significanceThreshold', message: 'must be a whole number of at least 1' })
  }
  if (errors.length > 0) return errors

  if (matrix !== null) {
    const rowsMatch = matrix.length === severityLevels && matrix.every(row => row.length === likelihoodLevels)
    if (!rowsMatch) {
      errors.push({ field: 'matrix', message: `must have ${severityLevels} rows of ${likelihoodLevels} cells` })
      return errors
    }
    if (!matrix.every(row => row.every(cell => Number.isInteger(cell) && cell >= 1))) {
      errors.push({ field: 'matrix', message: 'every cell must be a whole number of at least 1' })
      return errors
    }
  }

  const highestScore = matrix === null
    ? severityLevels * likelihoodLevels
    : Math.max(...matrix.flat())
  if (significanceThreshold > highestScore) {
    errors.push({ field: 'significanceThreshold', message: `no score reaches it; the highest possible score is ${highestScore}` })
  }
  return errors
}
