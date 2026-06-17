import { describe, it, expect } from 'vitest'
import {
  mean, variance, stdDev, median, quantile, percentile,
  coefficientOfVariation, skewness, histogram, normalPdf, zScore,
  poissonPmf, wilsonInterval, ewma, linearRegression, pearson, laggedCorrelation,
} from '../statistics'

describe('central tendency & spread', () => {
  it('mean: average, null on empty', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(mean([])).toBeNull()
  })

  it('variance/stdDev: sample (n-1), null when n<2', () => {
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 10)
    expect(stdDev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 10)
    expect(variance([7])).toBeNull()
    expect(stdDev([])).toBeNull()
  })

  it('median: handles even/odd, null on empty', () => {
    expect(median([1, 2, 3])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('quantile: type-7 interpolation', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10)
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10)
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10)
    expect(percentile([1, 2, 3, 4], 50)).toBe(median([1, 2, 3, 4]))
    expect(quantile([], 0.5)).toBeNull()
  })

  it('coefficientOfVariation: sd/mean, guards mean≈0 and n<2', () => {
    expect(coefficientOfVariation([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5) / 3, 10)
    expect(coefficientOfVariation([-1, 0, 1])).toBeNull() // mean ≈ 0
    expect(coefficientOfVariation([5])).toBeNull()
  })

  it('skewness: ~0 for symmetric, positive for right-skew, null n<3', () => {
    expect(skewness([1, 2, 3, 4, 5])!).toBeCloseTo(0, 6)
    expect(skewness([1, 1, 1, 2, 10])!).toBeGreaterThan(0)
    expect(skewness([1, 2])).toBeNull()
  })
})

describe('binning & density', () => {
  it('histogram: counts conserved, positive bin width', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(h.n).toBe(10)
    expect(h.binWidth).toBeGreaterThan(0)
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(10)
  })
  it('histogram: all-identical → single bin; n<2 → empty', () => {
    expect(histogram([5, 5, 5]).bins).toHaveLength(1)
    expect(histogram([5, 5, 5]).bins[0]!.count).toBe(3)
    expect(histogram([1]).bins).toHaveLength(0)
  })

  it('normalPdf: standard normal peak, 0 when sd<=0', () => {
    expect(normalPdf(0, 0, 1)).toBeCloseTo(0.39894228, 6)
    expect(normalPdf(1, 0, 0)).toBe(0)
  })

  it('zScore: standardizes, null when sd<=0', () => {
    expect(zScore(2, 0, 1)).toBe(2)
    expect(zScore(2, 0, 0)).toBeNull()
  })
})

describe('counts / rates', () => {
  it('poissonPmf: boundaries and a known value, sums to ~1', () => {
    expect(poissonPmf(0, 0)).toBe(1)
    expect(poissonPmf(1, 0)).toBe(0)
    expect(poissonPmf(-1, 3)).toBe(0)
    expect(poissonPmf(2, 3)).toBeCloseTo(Math.exp(-3) * 4.5, 8)
    let total = 0
    for (let k = 0; k <= 40; k++) total += poissonPmf(k, 3)
    expect(total).toBeCloseTo(1, 6)
  })

  it('wilsonInterval: brackets the point estimate, bounded, zeroed at n=0', () => {
    const ci = wilsonInterval(8, 10)
    expect(ci.point).toBeCloseTo(0.8, 10)
    expect(ci.lower).toBeLessThan(0.8)
    expect(ci.upper).toBeGreaterThan(0.8)
    expect(ci.lower).toBeGreaterThanOrEqual(0)
    expect(ci.upper).toBeLessThanOrEqual(1)
    expect(wilsonInterval(0, 0)).toEqual({ point: 0, lower: 0, upper: 0 })
  })
})

describe('smoothing & trend', () => {
  it('ewma: alpha=1 reduces to input; empty in → empty out', () => {
    expect(ewma([1, 2, 3], 1)).toEqual([1, 2, 3])
    expect(ewma([], 0.3)).toEqual([])
  })

  it('linearRegression: perfect line, null on zero x-variance / n<2', () => {
    const fit = linearRegression([0, 1, 2, 3], [1, 3, 5, 7])
    expect(fit!.slope).toBeCloseTo(2, 10)
    expect(fit!.intercept).toBeCloseTo(1, 10)
    expect(fit!.r2).toBeCloseTo(1, 10)
    expect(linearRegression([5, 5, 5], [1, 2, 3])).toBeNull()
    expect(linearRegression([1], [1])).toBeNull()
  })
})

describe('correlation', () => {
  it('pearson: ±1 for perfect (anti)correlation, null n<3 / zero variance', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])!).toBeCloseTo(1, 10)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])!).toBeCloseTo(-1, 10)
    expect(pearson([1, 2], [1, 2])).toBeNull()
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull()
  })

  it('laggedCorrelation: detects a one-period lead; null on small overlap', () => {
    const x = [1, 2, 3, 4, 5]
    const y = [0, 1, 2, 3, 4] // y[i] = x[i-1] → x leads y by 1
    expect(laggedCorrelation(x, y, 1)!).toBeCloseTo(1, 10)
    expect(laggedCorrelation(x, y, 9)).toBeNull()
  })
})
