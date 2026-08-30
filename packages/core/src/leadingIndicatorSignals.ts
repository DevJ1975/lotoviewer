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
// Honest by construction: it reports the correlation r and the overlap n,
// requires a minimum history before calling a signal `reliable`, and never
// implies causation. Built on the (previously unused) laggedCorrelation.

import { laggedCorrelation } from './statistics'

export interface LeadingSignalSeries {
  key:     string
  label:   string
  /** Monthly values, oldest → newest, index-aligned with recordablesMonthly. */
  monthly: number[]
}

export type SignalDirection = 'predicts_more' | 'predicts_fewer' | 'none'

export interface LeadingSignal {
  key:       string
  label:     string
  /** Months this indicator leads recordables (0 = concurrent). */
  bestLag:   number
  /** Correlation at bestLag, in [-1, 1]. */
  r:         number
  /** Overlapping months used for the correlation at bestLag. */
  nMonths:   number
  /** Positive r → higher indicator precedes MORE recordables; negative →
   *  FEWER (a protective signal, e.g. near-miss reporting). */
  direction: SignalDirection
  /** Enough history AND a meaningful |r| — gate UI claims on this. */
  reliable:  boolean
}

export interface DiscoverOptions {
  /** Largest lead (months) to scan. Default 4. */
  maxLag?:    number
  /** Minimum overlapping months before a signal is `reliable`. Default 12. */
  minMonths?: number
  /** |r| below this is treated as no real relationship. Default 0.3. */
  rFloor?:    number
}

/**
 * For each leading series, scan lags 0..maxLag against the recordable series
 * and keep the lag with the strongest |correlation|. Returns the signals
 * ranked reliable-first, then by |r| descending. Series with too little
 * overlap to correlate at any lag are dropped.
 */
export function discoverLeadingSignals(
  series: readonly LeadingSignalSeries[],
  recordablesMonthly: readonly number[],
  opts: DiscoverOptions = {},
): LeadingSignal[] {
  const maxLag    = Math.max(0, opts.maxLag ?? 4)
  const minMonths = opts.minMonths ?? 12
  const rFloor    = opts.rFloor ?? 0.3

  const out: LeadingSignal[] = []
  for (const s of series) {
    let best: { lag: number; r: number } | null = null
    for (let lag = 0; lag <= maxLag; lag++) {
      const r = laggedCorrelation(s.monthly, recordablesMonthly, lag)
      if (r == null) continue
      if (best === null || Math.abs(r) > Math.abs(best.r)) best = { lag, r }
    }
    if (best === null) continue // never enough overlap to correlate

    const nMonths = Math.min(s.monthly.length, recordablesMonthly.length - best.lag)
    const reliable = nMonths >= minMonths && Math.abs(best.r) >= rFloor
    const direction: SignalDirection =
      Math.abs(best.r) < rFloor ? 'none' : best.r > 0 ? 'predicts_more' : 'predicts_fewer'

    out.push({ key: s.key, label: s.label, bestLag: best.lag, r: best.r, nMonths, direction, reliable })
  }

  out.sort((a, b) =>
    (Number(b.reliable) - Number(a.reliable)) || (Math.abs(b.r) - Math.abs(a.r)))
  return out
}
