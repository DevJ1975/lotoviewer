import { describe, it, expect } from 'vitest'
import {
  mean, variance, stdDev, median, quantile, percentile,
  coefficientOfVariation, skewness, histogram, normalPdf, zScore,
  poissonPmf, wilsonInterval, poissonCountInterval, rateInterval,
  ewma, linearRegression, pearson, laggedCorrelation,
  seededRandom, shuffled, benjaminiHochberg,
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

  it('poissonCountInterval: point = count, brackets it, lower is 0 only for zero events', () => {
    const ci = poissonCountInterval(4)
    expect(ci.point).toBe(4)
    expect(ci.lower).toBeGreaterThan(0)
    expect(ci.lower).toBeLessThan(4)
    expect(ci.upper).toBeGreaterThan(4)
    expect(poissonCountInterval(0).lower).toBe(0)
    expect(poissonCountInterval(-3)).toEqual(poissonCountInterval(0)) // a negative count is no events
  })

  it('poissonCountInterval: zero events is NOT reported as perfectly precise', () => {
    // The old normal approximation returned [0, 0] here. With no recordables the
    // honest statement is "fewer than about 3.7 expected events at 95%".
    const ci = poissonCountInterval(0)
    expect(ci.upper).toBeCloseTo(3.6888794541139354, 10)
    expect(ci.upper).toBeGreaterThan(3)
  })

  it('poissonCountInterval: exact (Garwood) limits match scipy.stats.chi2 to 9 digits', () => {
    // Reference: lower = chi2.ppf(a/2, 2k)/2 (0 when k = 0), upper = chi2.ppf(1-a/2, 2k+2)/2,
    // scipy 1.17.1. Regenerate with:  from scipy.stats import chi2
    const reference: Array<[confidence: number, count: number, lower: number, upper: number]> = [
      [0.95, 0, 0, 3.6888794541139354],
      [0.95, 1, 0.025317807984289897, 5.571643390938898],
      [0.95, 2, 0.24220927854396507, 7.22468766772396],
      [0.95, 3, 0.6186721228956015, 8.767273069742323],
      [0.95, 5, 1.623486390118421, 11.66833207932267],
      [0.95, 10, 4.7953886961324335, 18.39035604201778],
      [0.95, 20, 12.216519585403946, 30.8883779026746],
      [0.95, 50, 37.110963737461866, 65.91876666433681],
      [0.95, 100, 81.36399125092315, 121.62679379242638],
      [0.95, 1000, 938.9730184076952, 1063.952136016302],
      [0.9, 0, 0, 2.9957322735539895],
      [0.9, 1, 0.05129329438755053, 4.743864518390577],
      [0.9, 10, 5.425405697091292, 16.962219235721903],
      [0.9, 100, 84.13927721831419, 118.07927278209706],
      [0.99, 0, 0, 5.298317366548036],
      [0.99, 1, 0.005012541823544286, 7.430129500280121],
      [0.99, 10, 3.716922131467116, 21.397827499654273],
      [0.99, 100, 76.12049584368918, 128.76058012010245],
    ]
    for (const [confidence, count, lower, upper] of reference) {
      const ci = poissonCountInterval(count, confidence)
      const tolerance = (x: number) => Math.max(1e-9 * Math.abs(x), 1e-12)
      expect(Math.abs(ci.lower - lower), `lower @ ${confidence} k=${count}`).toBeLessThan(tolerance(lower))
      expect(Math.abs(ci.upper - upper), `upper @ ${confidence} k=${count}`).toBeLessThan(tolerance(upper))
    }
  })

  it('poissonCountInterval: satisfies its own definition (independent of any reference table)', () => {
    // Lower limit: P(X >= k | lambda = lower) = a/2. Upper: P(X <= k | lambda = upper) = a/2.
    const cdf = (k: number, lambda: number) => { let s = 0; for (let i = 0; i <= k; i++) s += poissonPmf(i, lambda); return s }
    for (const k of [1, 2, 7, 25, 60]) {
      const ci = poissonCountInterval(k, 0.95)
      expect(1 - cdf(k - 1, ci.lower)).toBeCloseTo(0.025, 8)
      expect(cdf(k, ci.upper)).toBeCloseTo(0.025, 8)
    }
  })

  it('poissonCountInterval: higher confidence is wider, and it is conservative vs the old approximation at small counts', () => {
    const [c90, c95, c99] = [0.9, 0.95, 0.99].map(c => poissonCountInterval(3, c))
    expect(c99.upper - c99.lower).toBeGreaterThan(c95.upper - c95.lower)
    expect(c95.upper - c95.lower).toBeGreaterThan(c90.upper - c90.lower)
    // count ± 1.96·√count gave an upper bound of 3 + 3.39 = 6.39 for 3 events; exact is 8.77.
    expect(c95.upper).toBeGreaterThan(3 + 1.96 * Math.sqrt(3))
  })

  it('poissonCountInterval: stays accurate and fast for large counts', () => {
    const started = Date.now()
    const ci = poissonCountInterval(250_000)
    expect(Date.now() - started).toBeLessThan(250)
    // Large counts approach the normal interval: 250000 ± 1.96·500 = 249020..250980.
    expect(ci.lower).toBeGreaterThan(249_000)
    expect(ci.lower).toBeLessThan(249_100)
    expect(ci.upper).toBeGreaterThan(250_900)
    expect(ci.upper).toBeLessThan(251_000)
  })

  it('poissonCountInterval: rejects a confidence level that is not strictly between 0 and 1', () => {
    for (const bad of [0, 1, -0.5, 1.5, NaN]) expect(() => poissonCountInterval(3, bad)).toThrow(RangeError)
  })

  it('poissonCountInterval: refuses a count it cannot answer correctly instead of guessing', () => {
    for (const bad of [NaN, Infinity, -Infinity, 1e10]) expect(() => poissonCountInterval(bad)).toThrow(RangeError)
  })

  it('rateInterval: no interval for exposure that is zero, negative, infinite or not a number', () => {
    for (const hours of [0, -1, NaN, Infinity]) expect(rateInterval(3, hours), String(hours)).toBeNull()
  })

  it('rateInterval: scales the count interval by base/hours; null when hours=0', () => {
    // 1 recordable in 100k hours → TRIR point = 1·200000/100000 = 2
    const ci = rateInterval(1, 100_000)!
    expect(ci.point).toBeCloseTo(2, 10)
    expect(ci.lower).toBeCloseTo(0.025317807984289897 * 2, 9)
    expect(ci.upper).toBeCloseTo(5.571643390938898 * 2, 9)
    expect(rateInterval(5, 0)).toBeNull()
    expect(rateInterval(5, -10)).toBeNull()
  })

  it('rateInterval: a plant with no recordables still shows real uncertainty', () => {
    const ci = rateInterval(0, 100_000)!
    expect(ci.point).toBe(0)
    expect(ci.lower).toBe(0)
    expect(ci.upper).toBeCloseTo(3.6888794541139354 * 2, 9)
  })

  it('rateInterval: honours the base and the confidence level', () => {
    const wide = rateInterval(2, 50_000, 100, 0.99)!
    const narrow = rateInterval(2, 50_000, 100, 0.9)!
    expect(wide.point).toBeCloseTo(0.004, 12) // 2·100/50000
    expect(wide.upper - wide.lower).toBeGreaterThan(narrow.upper - narrow.lower)
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

describe('resampling & multiple comparisons', () => {
  it('seededRandom: same seed, same stream; values in [0, 1)', () => {
    const a = seededRandom(42), b = seededRandom(42), c = seededRandom(43)
    const streamA = Array.from({ length: 1000 }, a)
    expect(Array.from({ length: 1000 }, b)).toEqual(streamA)
    expect(Array.from({ length: 1000 }, c)).not.toEqual(streamA)
    expect(streamA.every(v => v >= 0 && v < 1)).toBe(true)
    expect(mean(streamA)!).toBeCloseTo(0.5, 1)
  })

  it('shuffled: a reordering of the same values, input untouched', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffled(input, seededRandom(7))
    expect([...out].sort((x, y) => x - y)).toEqual(input)
    expect(out).not.toEqual(input)
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('benjaminiHochberg: matches scipy.stats.false_discovery_control, in input order', () => {
    // Reference values from SciPy 1.17 (method='bh').
    expect(benjaminiHochberg([0.01, 0.04, 0.03, 0.005])).toEqual([0.02, 0.04, 0.04, 0.02])
    const q = benjaminiHochberg([0.2, 0.001, 0.5, 0.04, 0.03])
    ;[0.25, 0.005, 0.5, 0.2 / 3, 0.2 / 3].forEach((want, i) => expect(q[i]).toBeCloseTo(want, 12))
    expect(benjaminiHochberg([1, 1])).toEqual([1, 1])
    expect(benjaminiHochberg([])).toEqual([])
  })
})
