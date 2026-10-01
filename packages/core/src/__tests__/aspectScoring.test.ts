import { describe, it, expect } from 'vitest'
import {
  aspectCompleteness,
  currentScoresByCondition,
  scoreAspect,
  validateAspectInput,
  validateAspectScoreInput,
  type AspectInput,
  type AspectOperatingCondition,
} from '../environmentalAspect'
import { DEFAULT_SCORING_METHOD, type ScoringMethodDefinition } from '../scoringMethod'

const MATRIX_METHOD: ScoringMethodDefinition = {
  severityLevels: 3,
  likelihoodLevels: 3,
  matrix: [[1, 2, 3], [2, 4, 6], [3, 6, 9]],
  significanceThreshold: 6,
}

describe('scoreAspect (default 5 x 5 method, threshold 12)', () => {
  it('is significant exactly at the threshold: 3 x 4 = 12', () => {
    expect(scoreAspect(3, 4, DEFAULT_SCORING_METHOD)).toEqual({ score: 12, significant: true })
  })

  it('is not significant one below: 11 is unreachable, so 2 x 5 = 10 and 5 x 2 = 10', () => {
    expect(scoreAspect(2, 5, DEFAULT_SCORING_METHOD)).toEqual({ score: 10, significant: false })
    expect(scoreAspect(5, 2, DEFAULT_SCORING_METHOD)).toEqual({ score: 10, significant: false })
  })

  it('is significant above the threshold: 13 is unreachable, so 4 x 4 = 16', () => {
    expect(scoreAspect(4, 4, DEFAULT_SCORING_METHOD)).toEqual({ score: 16, significant: true })
  })

  it('covers the scale corners', () => {
    expect(scoreAspect(1, 1, DEFAULT_SCORING_METHOD)).toEqual({ score: 1, significant: false })
    expect(scoreAspect(5, 5, DEFAULT_SCORING_METHOD)).toEqual({ score: 25, significant: true })
  })

  it('agrees with the retired generated columns (score >= 12) on every cell of the 5 x 5 grid', () => {
    for (let s = 1; s <= 5; s++) {
      for (let l = 1; l <= 5; l++) {
        expect(scoreAspect(s, l, DEFAULT_SCORING_METHOD)).toEqual({ score: s * l, significant: s * l >= 12 })
      }
    }
  })
})

describe('scoreAspect (matrix method)', () => {
  it('reads matrix[severity - 1][likelihood - 1], not the product', () => {
    expect(scoreAspect(2, 3, MATRIX_METHOD).score).toBe(6)
    expect(scoreAspect(3, 1, MATRIX_METHOD).score).toBe(3)
  })

  it('compares against the method threshold, inclusive', () => {
    expect(scoreAspect(2, 3, MATRIX_METHOD).significant).toBe(true)   // 6 = threshold
    expect(scoreAspect(2, 2, MATRIX_METHOD).significant).toBe(false)  // 4
  })

  it('uses a matrix cell even when it differs from severity x likelihood', () => {
    const skewed: ScoringMethodDefinition = { ...MATRIX_METHOD, matrix: [[1, 1, 1], [1, 1, 1], [1, 1, 9]] }
    expect(scoreAspect(3, 3, skewed)).toEqual({ score: 9, significant: true })
    expect(scoreAspect(2, 3, skewed)).toEqual({ score: 1, significant: false })
  })
})

describe('aspectCompleteness', () => {
  const ALL: AspectOperatingCondition[] = ['normal', 'abnormal', 'emergency']
  const subsets: AspectOperatingCondition[][] = [
    [], ['normal'], ['abnormal'], ['emergency'],
    ['normal', 'abnormal'], ['normal', 'emergency'], ['abnormal', 'emergency'], ALL,
  ]

  for (const subset of subsets) {
    it(`reports [${subset.join(', ') || 'none'}] covered and the rest missing, in N / A / E order`, () => {
      const result = aspectCompleteness(subset.map(c => ({ operatingCondition: c })))
      expect(result.covered).toEqual(ALL.filter(c => subset.includes(c)))
      expect(result.missing).toEqual(ALL.filter(c => !subset.includes(c)))
    })
  }

  it('collapses repeated scores of one condition', () => {
    const result = aspectCompleteness([{ operatingCondition: 'normal' }, { operatingCondition: 'normal' }])
    expect(result).toEqual({ covered: ['normal'], missing: ['abnormal', 'emergency'] })
  })
})

describe('currentScoresByCondition', () => {
  const s = (id: string, operatingCondition: AspectOperatingCondition, scoredAt: string) => ({ id, operatingCondition, scoredAt })

  it('keeps the latest score per condition', () => {
    const current = currentScoresByCondition([
      s('a', 'normal', '2026-01-01T00:00:00Z'),
      s('b', 'normal', '2026-03-01T00:00:00Z'),
      s('c', 'emergency', '2026-02-01T00:00:00Z'),
    ])
    expect(current.normal?.id).toBe('b')
    expect(current.emergency?.id).toBe('c')
    expect(current.abnormal).toBeUndefined()
  })

  it('compares instants, not strings, across timezone offsets', () => {
    const current = currentScoresByCondition([
      s('earlier', 'normal', '2026-01-01T10:00:00+05:00'),   // 05:00 UTC
      s('later', 'normal', '2026-01-01T06:00:00+00:00'),     // 06:00 UTC
    ])
    expect(current.normal?.id).toBe('later')
  })

  it('breaks an exact timestamp tie with the higher id, like the view', () => {
    const at = '2026-01-01T00:00:00Z'
    expect(currentScoresByCondition([s('0a', 'normal', at), s('0b', 'normal', at)]).normal?.id).toBe('0b')
    expect(currentScoresByCondition([s('0b', 'normal', at), s('0a', 'normal', at)]).normal?.id).toBe('0b')
  })

  it('returns nothing for no scores', () => {
    expect(currentScoresByCondition([])).toEqual({})
  })
})

describe('validateAspectInput', () => {
  const valid: AspectInput = {
    activity: 'Parts degreasing', aspect: 'Solvent vapour release', impact: 'Air pollution (VOC)',
    processArea: 'Finishing', lifeCycleStage: 'operation', flow: 'output', status: 'identified',
    controls: null, notes: null,
  }
  const fields = (input: AspectInput) => validateAspectInput(input).map(e => e.field)

  it('accepts a complete aspect', () => {
    expect(validateAspectInput(valid)).toEqual([])
  })

  it('requires activity, aspect, impact and process area', () => {
    expect(fields({ ...valid, activity: ' ', aspect: '', impact: '', processArea: '' }))
      .toEqual(['activity', 'aspect', 'impact', 'processArea'])
  })

  it('caps text lengths at the documented limits', () => {
    expect(fields({ ...valid, processArea: 'x'.repeat(120) })).toEqual([])
    expect(fields({ ...valid, processArea: 'x'.repeat(121) })).toEqual(['processArea'])
    expect(fields({ ...valid, controls: 'x'.repeat(4001) })).toEqual(['controls'])
  })

  it('rejects unknown enum values', () => {
    expect(fields({ ...valid, lifeCycleStage: 'mining' as AspectInput['lifeCycleStage'] })).toEqual(['lifeCycleStage'])
    expect(fields({ ...valid, flow: 'sideways' as AspectInput['flow'] })).toEqual(['flow'])
    expect(fields({ ...valid, status: 'obsolete' as AspectInput['status'] })).toEqual(['status'])
  })

  it('accepts an empty flow', () => {
    expect(fields({ ...valid, flow: null })).toEqual([])
  })
})

describe('validateAspectScoreInput', () => {
  const valid = { operatingCondition: 'emergency' as const, severity: 5, likelihood: 1, rationale: 'Bund failure releases solvent to the drain.' }
  const fields = (input: typeof valid | Record<string, unknown>, method = DEFAULT_SCORING_METHOD) =>
    validateAspectScoreInput(input as typeof valid, method).map(e => e.field)

  it('accepts a score inside the method scale', () => {
    expect(fields(valid)).toEqual([])
  })

  it('bounds severity and likelihood by the method scale, inclusive', () => {
    expect(fields({ ...valid, severity: 0 })).toEqual(['severity'])
    expect(fields({ ...valid, severity: 6 })).toEqual(['severity'])
    expect(fields({ ...valid, severity: 3, likelihood: 3 }, MATRIX_METHOD)).toEqual([])
    expect(fields({ ...valid, severity: 3, likelihood: 4 }, MATRIX_METHOD)).toEqual(['likelihood'])
    expect(fields({ ...valid, severity: 2.5 })).toEqual(['severity'])
  })

  it('requires a rationale, because a bare number is not a documented assessment', () => {
    expect(fields({ ...valid, rationale: '   ' })).toEqual(['rationale'])
  })

  it('rejects an unknown operating condition', () => {
    expect(fields({ ...valid, operatingCondition: 'startup' })).toEqual(['operatingCondition'])
  })
})
