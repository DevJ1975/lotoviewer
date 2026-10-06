// Leading→lagging signal discovery. Pure, no I/O.
//
// The scorecard co-locates many leading indicators (near-miss reporting,
// inspection fail-rate, BBS at-risk %, overdue CAPAs, training gaps) with the
// lagging outcome (OSHA recordables), but never tests whether any of them
// actually PRECEDES incidents for a given tenant. This finds, per indicator,
// the lag (in months) at which its monthly series best correlates with the
// recordable series — turning "we track these" into "when near-miss reporting
// drops, recordables rise ~2 months later."
//
// Picking the best of several lags on 12–18 noisy monthly counts finds a
// strong-looking r by luck almost every time: a fixed |r| ≥ 0.3 cut-off
// flagged about three in four indicators that had no relationship at all
// (EHS scorecard analytics review, §9). So each indicator is tested against chance instead:
// its months are shuffled many times, the same best-lag scan runs on every
// shuffle, and p is the share of shuffles that look at least as strong. The
// p-values are then Benjamini–Hochberg adjusted across the indicators, and
// only q ≤ fdrLevel counts. It still reports correlation, never causation.
//
// Shuffling assumes the months are interchangeable, which a trend breaks: two
// unrelated series that both grow (a maturing BBS programme, a growing
// headcount) correlate anyway, and the shuffle test passed ~27% of such pairs.
// So each aligned window is detrended first, and the test asks the question a
// leading indicator should answer: do its swings around its own trend precede
// swings in recordables around theirs?
//
// Two more things would manufacture signals, so they are excluded outright:
//   - Lag 0. A same-month move is not a lead, and it is where reverse
//     causation hides (an inspection blitz the week after an injury) — the
//     same leak that keeps "CAPAs opened" out of the indicator list.
//   - Months before a module went live. They were unobserved, not zero, and
//     zero-filling them gives the indicator and recordables a shared
//     "nothing, then something" step that no straight-line detrend removes.
//     Callers mark the first observed month with `observedFrom`.
//
// What remains is documented, not fixed: seasonality and strongly persistent
// monthly rates (large tenants) still run up to ~1.8× the nominal false-alarm
// rate, and only the existence of a link is tested — the lag, direction and r
// reported are the best of those scanned, so they overstate the certainty.

import { benjaminiHochberg, linearRegression, pearson, seededRandom, shuffled } from './statistics'

export interface LeadingSignalSeries {
  key:     string
  label:   string
  /** Monthly values, oldest → newest, index-aligned with recordablesMonthly. */
  monthly: number[]
  /** Index of the first month in which both this indicator and recordables
   *  were being recorded. Earlier months are left out (see the header).
   *  Default 0. */
  observedFrom?: number
}

export type SignalDirection = 'predicts_more' | 'predicts_fewer' | 'none'

export interface LeadingSignal {
  key:       string
  label:     string
  /** Months this indicator leads recordables (1..maxLag). */
  bestLag:   number
  /** Correlation at bestLag after removing each window's linear trend, in [-1, 1]. */
  r:         number
  /** Observed, overlapping months used for the correlation at bestLag. */
  nMonths:   number
  /** Permutation p-value: the chance a shuffled series scans to an |r| this strong. */
  p:         number
  /** Benjamini–Hochberg adjusted p across the indicators in the same call. */
  q:         number
  /** Positive r → higher indicator precedes MORE recordables; negative →
   *  FEWER (a protective signal, e.g. near-miss reporting). 'none' when the
   *  relationship does not clear the false-discovery check. */
  direction: SignalDirection
  /** Enough history AND clears the false-discovery check — gate UI claims on this. */
  reliable:  boolean
}

/** Shuffles per indicator unless overridden; resolves p down to 0.001. */
export const DEFAULT_PERMUTATIONS = 999
/** Highest BH q-value that still counts unless overridden. */
export const DEFAULT_FDR_LEVEL = 0.1

export interface DiscoverOptions {
  /** Largest lead (months) to scan, from 1. Default 4. */
  maxLag?:       number
  /** Minimum overlapping months before a signal is `reliable`. Default 12. */
  minMonths?:    number
  /** Highest BH q-value that still counts as a signal. Default
   *  DEFAULT_FDR_LEVEL — this is a screen for what to investigate, not a verdict. */
  fdrLevel?:     number
  /** Shuffles per indicator. Default DEFAULT_PERMUTATIONS. */
  permutations?: number
}

// Fixed, so the same data always yields the same p-values.
const PERMUTATION_SEED = 0x5afe7
// The shortest lead scanned: lag 0 is a same-month move, not a lead.
const FIRST_LAG = 1
// A line fitted through fewer aligned months leaves too few residuals for a
// correlation between them to mean anything.
const MIN_OVERLAP = 4
// Residuals this small are floating-point noise around a perfectly straight
// series, not variation; correlating them would invent a signal.
const FLAT_RESIDUAL = 1e-9
// Ties in |r| between the observed and a shuffled series count against the
// signal; this absorbs floating-point noise in the comparison.
const TIE_TOLERANCE = 1e-12

/**
 * For each leading series, scan lags 1..maxLag against the recordable series,
 * keep the lag with the strongest |correlation|, and test it against chance.
 * Returns the signals ranked reliable-first, then by |r| descending. Series
 * with too little overlap or variation to correlate at any lag are dropped.
 */
export function discoverLeadingSignals(
  series: readonly LeadingSignalSeries[],
  recordablesMonthly: readonly number[],
  opts: DiscoverOptions = {},
): LeadingSignal[] {
  const maxLag       = Math.max(FIRST_LAG, opts.maxLag ?? 4)
  const minMonths    = opts.minMonths ?? 12
  const fdrLevel     = opts.fdrLevel ?? DEFAULT_FDR_LEVEL
  const permutations = opts.permutations ?? DEFAULT_PERMUTATIONS

  const tested = series.flatMap(s => {
    const from = Math.max(0, s.observedFrom ?? 0)
    const indicator = s.monthly.slice(from)
    const recordables = recordablesMonthly.slice(from)
    const best = strongestLag(indicator, recordables, maxLag)
    if (best === null) return [] // never enough overlap or variation to correlate
    const p = permutationPValue(indicator, recordables, maxLag, Math.abs(best.r), permutations)
    return [{ s, indicator, recordables, best, p }]
  })
  const qs = benjaminiHochberg(tested.map(t => t.p))

  const out: LeadingSignal[] = tested.map(({ s, indicator, recordables, best, p }, i) => {
    const q = qs[i]!
    const nMonths = Math.min(indicator.length, recordables.length - best.lag)
    const significant = q <= fdrLevel
    return {
      key: s.key, label: s.label, bestLag: best.lag, r: best.r, nMonths, p, q,
      direction: !significant ? 'none' : best.r > 0 ? 'predicts_more' : 'predicts_fewer',
      reliable: significant && nMonths >= minMonths,
    }
  })

  out.sort((a, b) =>
    (Number(b.reliable) - Number(a.reliable)) || (Math.abs(b.r) - Math.abs(a.r)))
  return out
}

function strongestLag(
  indicator: readonly number[],
  recordables: readonly number[],
  maxLag: number,
): { lag: number; r: number } | null {
  let best: { lag: number; r: number } | null = null
  for (let lag = FIRST_LAG; lag <= maxLag; lag++) {
    const r = trendFreeCorrelation(indicator, recordables, lag)
    if (r == null) continue
    if (best === null || Math.abs(r) > Math.abs(best.r)) best = { lag, r }
  }
  return best
}

// Pearson r between the indicator and the recordables `lag` months later,
// each window first detrended. Null when either window is too short or has
// no variation around its trend.
function trendFreeCorrelation(
  indicator: readonly number[],
  recordables: readonly number[],
  lag: number,
): number | null {
  const overlap = Math.min(indicator.length, recordables.length - lag)
  if (overlap < MIN_OVERLAP) return null
  const x = detrended(indicator.slice(0, overlap))
  const y = detrended(recordables.slice(lag, lag + overlap))
  if (isFlat(x) || isFlat(y)) return null
  return pearson(x, y)
}

function detrended(window: readonly number[]): number[] {
  // Never null here: the month index always varies once overlap ≥ 2.
  const fit = linearRegression(window.map((_, month) => month), window)!
  return window.map((value, month) => value - (fit.intercept + fit.slope * month))
}

function isFlat(residuals: readonly number[]): boolean {
  return residuals.every(r => Math.abs(r) < FLAT_RESIDUAL)
}

// The share of shuffled indicators whose best-lag |r| reaches the observed
// one. Shuffling keeps the indicator's values but breaks any link in time to
// recordables, and re-running the full lag scan on every shuffle charges the
// observed signal for having had maxLag + 1 chances to look strong.
function permutationPValue(
  indicator: readonly number[],
  recordables: readonly number[],
  maxLag: number,
  observedStrength: number,
  permutations: number,
): number {
  const random = seededRandom(PERMUTATION_SEED)
  let atLeastAsStrong = 0
  for (let i = 0; i < permutations; i++) {
    const best = strongestLag(shuffled(indicator, random), recordables, maxLag)
    if (best !== null && Math.abs(best.r) >= observedStrength - TIE_TOLERANCE) atLeastAsStrong++
  }
  // The observed series counts as one of the arrangements, so p is never 0.
  return (atLeastAsStrong + 1) / (permutations + 1)
}
