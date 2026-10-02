import { describe, it, expect } from 'vitest'
import { DEFAULT_SCORING_METHOD, validateScoringMethod, type ScoringMethodDefinition } from '../scoringMethod'

const MATRIX_3X3: ScoringMethodDefinition = {
  severityLevels: 3,
  likelihoodLevels: 3,
  matrix: [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
  significanceThreshold: 6,
}

function fields(method: ScoringMethodDefinition): string[] {
  return validateScoringMethod(method).map(e => e.field)
}

describe('DEFAULT_SCORING_METHOD', () => {
  it('keeps the rule migration 204 hard-coded: 5 x 5, significant at 12, no matrix', () => {
    expect(DEFAULT_SCORING_METHOD).toEqual({ severityLevels: 5, likelihoodLevels: 5, matrix: null, significanceThreshold: 12 })
  })

  it('is itself valid', () => {
    expect(validateScoringMethod(DEFAULT_SCORING_METHOD)).toEqual([])
  })
})

describe('validateScoringMethod', () => {
  it('accepts a well-formed matrix method', () => {
    expect(validateScoringMethod(MATRIX_3X3)).toEqual([])
  })

  it('rejects level counts outside 2..10 and non-integers', () => {
    expect(fields({ ...DEFAULT_SCORING_METHOD, severityLevels: 1 })).toContain('severityLevels')
    expect(fields({ ...DEFAULT_SCORING_METHOD, likelihoodLevels: 11 })).toContain('likelihoodLevels')
    expect(fields({ ...DEFAULT_SCORING_METHOD, severityLevels: 4.5 })).toContain('severityLevels')
  })

  it('rejects a threshold below 1', () => {
    expect(fields({ ...DEFAULT_SCORING_METHOD, significanceThreshold: 0 })).toEqual(['significanceThreshold'])
  })

  it('rejects a matrix whose shape does not match the level counts', () => {
    expect(fields({ ...MATRIX_3X3, matrix: [[1, 2, 3], [2, 4, 6]] })).toEqual(['matrix'])
    expect(fields({ ...MATRIX_3X3, matrix: [[1, 2], [2, 4], [3, 6]] })).toEqual(['matrix'])
  })

  it('rejects a matrix with a zero, negative, or fractional cell', () => {
    expect(fields({ ...MATRIX_3X3, matrix: [[0, 2, 3], [2, 4, 6], [3, 6, 9]] })).toEqual(['matrix'])
    expect(fields({ ...MATRIX_3X3, matrix: [[1, 2, 3], [2, -4, 6], [3, 6, 9]] })).toEqual(['matrix'])
    expect(fields({ ...MATRIX_3X3, matrix: [[1, 2, 3], [2, 4.5, 6], [3, 6, 9]] })).toEqual(['matrix'])
  })

  it('rejects a threshold no score can reach, at the exact boundary', () => {
    expect(fields({ ...DEFAULT_SCORING_METHOD, significanceThreshold: 25 })).toEqual([])
    expect(fields({ ...DEFAULT_SCORING_METHOD, significanceThreshold: 26 })).toEqual(['significanceThreshold'])
    expect(fields({ ...MATRIX_3X3, significanceThreshold: 9 })).toEqual([])
    expect(fields({ ...MATRIX_3X3, significanceThreshold: 10 })).toEqual(['significanceThreshold'])
  })
})
