import { describe, it, expect } from 'vitest'
import {
  aspectSignificanceScore,
  aspectSignificanceBand,
  isAspectSignificant,
  ASPECT_SIGNIFICANCE_THRESHOLD,
} from '@soteria/core/environmentalAspect'

describe('aspectSignificanceScore', () => {
  it('multiplies severity by likelihood', () => {
    expect(aspectSignificanceScore(1, 1)).toBe(1)
    expect(aspectSignificanceScore(3, 4)).toBe(12)
    expect(aspectSignificanceScore(5, 5)).toBe(25)
  })
})

describe('aspectSignificanceBand', () => {
  it('bands the 1..25 score at the documented boundaries', () => {
    expect(aspectSignificanceBand(1)).toBe('low')
    expect(aspectSignificanceBand(5)).toBe('low')
    expect(aspectSignificanceBand(6)).toBe('moderate')
    expect(aspectSignificanceBand(11)).toBe('moderate')
    expect(aspectSignificanceBand(12)).toBe('high')
    expect(aspectSignificanceBand(19)).toBe('high')
    expect(aspectSignificanceBand(20)).toBe('extreme')
    expect(aspectSignificanceBand(25)).toBe('extreme')
  })
})

describe('isAspectSignificant', () => {
  it('is true exactly at and above the threshold (12)', () => {
    expect(ASPECT_SIGNIFICANCE_THRESHOLD).toBe(12)
    expect(isAspectSignificant(11)).toBe(false)
    expect(isAspectSignificant(12)).toBe(true)
    expect(isAspectSignificant(25)).toBe(true)
  })

  it('agrees with the high/extreme bands', () => {
    for (let score = 1; score <= 25; score++) {
      const band = aspectSignificanceBand(score)
      const significant = isAspectSignificant(score)
      expect(significant).toBe(band === 'high' || band === 'extreme')
    }
  })
})
