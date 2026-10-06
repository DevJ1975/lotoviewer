import { describe, it, expect } from 'vitest'
import { discoverLeadingSignals, type LeadingSignalSeries } from '../leadingIndicatorSignals'
import { seededRandom } from '../statistics'

// A non-monotonic monthly pattern. Recordables that echo it 2 months later
// are a genuine lead; two lines that merely rise together are not — a shared
// trend is exactly what the discovery test discounts.
const PATTERN = [2, 5, 1, 8, 3, 7, 2, 9, 4, 6, 1, 8, 5, 3]
const ECHO_2_MONTHS_LATER = [0, 0, ...PATTERN.slice(0, 12)] // recordables[i] = PATTERN[i-2]

describe('discoverLeadingSignals', () => {
  it('finds the lag at which an indicator best precedes recordables', () => {
    const leads2: LeadingSignalSeries = { key: 'x', label: 'X', monthly: PATTERN }
    const [sig] = discoverLeadingSignals([leads2], ECHO_2_MONTHS_LATER)
    expect(sig.bestLag).toBe(2)
    expect(sig.r).toBeCloseTo(1, 6)
    expect(sig.direction).toBe('predicts_more')
    expect(sig.reliable).toBe(true)
    expect(sig.nMonths).toBe(12)
    // No shuffle of the pattern lines up perfectly, so p sits at its floor.
    expect(sig.p).toBeCloseTo(1 / 1000, 10)
  })

  it('labels an inverse (protective) leader as predicting fewer recordables', () => {
    const protective: LeadingSignalSeries = {
      key: 'nm', label: 'Near-miss reporting',
      monthly: PATTERN.map(v => 10 - v), // dips exactly when recordables later spike
    }
    const [sig] = discoverLeadingSignals([protective], ECHO_2_MONTHS_LATER)
    expect(sig.r).toBeLessThan(0)
    expect(sig.direction).toBe('predicts_fewer')
  })

  it('does not report two unrelated series as a signal just because both rise', () => {
    // A maturing BBS programme and a growing headcount: steady growth, with
    // month-to-month wobbles that have nothing to do with each other.
    const indicator   = PATTERN.map((wobble, month) => 10 + 3 * month + wobble)
    const recordables = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7].map((wobble, month) => 2 + month + wobble)
    const [sig] = discoverLeadingSignals([{ key: 'bbs', label: 'BBS', monthly: indicator }], recordables)
    expect(sig.reliable).toBe(false)
    expect(sig.direction).toBe('none')
  })

  it('marks a signal unreliable when history is too short but still correlatable', () => {
    const short: LeadingSignalSeries = { key: 's', label: 'S', monthly: [1, 3, 2, 4, 2] }
    const [sig] = discoverLeadingSignals([short], [2, 1, 4, 3, 5], { minMonths: 12 })
    expect(sig.reliable).toBe(false)
  })

  it('drops a series with too little overlap or variation to correlate at any lag', () => {
    expect(discoverLeadingSignals([{ key: 't', label: 'T', monthly: [1, 2, 3] }], [1, 2, 3])).toHaveLength(0)
    // A perfectly straight series has no swings around its trend to compare.
    const straight = { key: 'line', label: 'line', monthly: [1, 2, 3, 4, 5, 6, 7, 8] }
    expect(discoverLeadingSignals([straight], [3, 1, 4, 1, 5, 9, 2, 6])).toHaveLength(0)
  })

  it('ranks reliable signals ahead of unreliable ones', () => {
    const strong: LeadingSignalSeries = { key: 'strong', label: 'strong', monthly: PATTERN }
    const weak: LeadingSignalSeries = { key: 'weak', label: 'weak', monthly: [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7] }
    const out = discoverLeadingSignals([weak, strong], ECHO_2_MONTHS_LATER)
    expect(out[0].key).toBe('strong')
    expect(out[0].reliable).toBe(true)
  })

  it('adjusts for testing several indicators at once (q ≥ p) and is deterministic', () => {
    const series = [
      { key: 'a', label: 'A', monthly: PATTERN },
      { key: 'b', label: 'B', monthly: [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7] },
    ]
    const first = discoverLeadingSignals(series, ECHO_2_MONTHS_LATER)
    for (const s of first) expect(s.q).toBeGreaterThanOrEqual(s.p)
    expect(discoverLeadingSignals(series, ECHO_2_MONTHS_LATER)).toEqual(first)
  })

  it('keeps false alarms near the FDR level on data with no real relationship', () => {
    // The old fixed |r| ≥ 0.3 cut-off flagged ~77% of such indicators and put
    // at least one false signal on ~99% of panels (scorecard review, §9).
    const random = seededRandom(2026)
    const poisson = (lambda: number) => {
      let k = 0, product = 1
      const limit = Math.exp(-lambda)
      do { k++; product *= random() } while (product > limit)
      return k - 1
    }
    const months = (lambda: number) => Array.from({ length: 18 }, () => poisson(lambda))

    const PANELS = 120
    let panelsWithAFalseSignal = 0
    for (let panel = 0; panel < PANELS; panel++) {
      const indicators = [5, 8, 3].map((lambda, i) => ({ key: `k${i}`, label: `k${i}`, monthly: months(lambda) }))
      const signals = discoverLeadingSignals(indicators, months(1.5), { permutations: 199 })
      if (signals.some(s => s.reliable)) panelsWithAFalseSignal++
    }
    // Nominal rate under this null is 10%; the bound leaves room for sampling noise.
    expect(panelsWithAFalseSignal / PANELS).toBeLessThan(0.2)
  })
})
