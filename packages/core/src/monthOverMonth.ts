// Pure logic for month-over-month movement on the EHS scorecard. No I/O.
//
// Deliberately NOT an extension of buildWeatherRow (scorecardWeatherReport.ts).
// That helper gates a 7-day move with |current - previous| >= sqrt(current +
// previous), which is roughly one Poisson standard deviation of a two-point
// estimate. At monthly counts that gate is both too loose and non-monotone: it
// calls 0 -> 1 significant but not 1 -> 2 or 2 -> 4, which are doublings. A
// reader who sees a doubling render as "no change" stops trusting the strip.
//
// Instead the move is judged against the tenant's OWN historical variation,
// using the c-chart limits already in forecast.ts: a month is flagged only when
// it falls outside the control limits computed from the preceding months. That
// is monotone by construction, degrades correctly at low counts, and reuses
// machinery the scorecard already ships.
//
// Two suppression rules keep the strip honest on small programmes:
//   - too few events to compare at all (see MOM_MIN_COMBINED)
//   - too little history to know what normal looks like (MOM_MIN_HISTORY)
// A suppressed row still shows both counts. It just does not draw a verdict.

import { cChartLimits } from './forecast'
import type { WeatherDirection, WeatherTone } from './scorecardWeatherReport'

/**
 * Minimum combined events (current + previous) before a month-over-month move
 * is judged. Below this no split of the two months could clear the control
 * limits anyway, so colouring one would be asserting a difference the counts
 * cannot support. A programme running ~12 recordables a year sits at ~2
 * combined across any two months — for that tenant a recordable delta is never
 * renderable, and saying so is the honest outcome.
 */
export const MOM_MIN_COMBINED = 10

/**
 * Minimum months of closed history before the c-chart gate can judge a move.
 * Limits computed from fewer periods track the noise rather than the process.
 */
export const MOM_MIN_HISTORY = 6

export type MonthOverMonthSuppression =
  | 'insufficient_events'
  | 'insufficient_history'
  | 'no_comparison_month'

export interface MonthCount {
  /** YYYY-MM in UTC. */
  month: string
  count: number
}

export interface MonthOverMonthInput {
  key:            string
  label:          string
  /** true: higher is better; false: lower is better; null: neutral (no tone). */
  higherIsBetter: boolean | null
  /**
   * Dense ascending YYYY-MM series of CLOSED months, oldest first. The caller
   * must exclude the current, partial month — comparing a part-month against a
   * whole one manufactures an improvement on every render.
   */
  series:         ReadonlyArray<MonthCount>
  unit?:          string
}

export interface MonthOverMonthRow {
  key:          string
  label:        string
  current:      number
  previous:     number
  delta:        number
  /** Percent change; null when the baseline is too small to express one. */
  deltaPct:     number | null
  direction:    WeatherDirection
  tone:         WeatherTone
  /** True only when the month falls outside its own history's control limits. */
  significant:  boolean
  /** YYYY-MM of the compared months, for labelling ("June vs May"). */
  currentMonth:  string | null
  previousMonth: string | null
  /** Why no verdict was drawn, when none was. */
  suppressed:   MonthOverMonthSuppression | null
  unit:         string
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Bucket timestamps into dense UTC calendar months, oldest first, ending with
 * the last CLOSED month — the current partial month is always dropped.
 *
 * `months` is how many closed months to return. Rows outside the range, and
 * rows whose timestamp is absent or unparseable, are ignored rather than
 * silently bucketed to the epoch.
 */
export function closedMonthSeries<T>(
  rows: ReadonlyArray<T>,
  getIso: (row: T) => string | null | undefined,
  nowMs: number,
  months: number,
): MonthCount[] {
  if (months <= 0) return []
  const now = new Date(nowMs)
  // First day of the current (partial) month — the exclusive upper bound.
  const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  const firstStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)

  const buckets = new Map<string, number>()
  for (let i = 0; i < months; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + i, 1))
    buckets.set(d.toISOString().slice(0, 7), 0)
  }

  for (const row of rows) {
    const iso = getIso(row)
    if (!iso) continue
    const ms = new Date(iso).getTime()
    if (Number.isNaN(ms)) continue
    if (ms < firstStart || ms >= currentMonthStart) continue
    const key = new Date(ms).toISOString().slice(0, 7)
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  return Array.from(buckets.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Judge the last closed month against the one before it, using control limits
 * built from the months that PRECEDE the one under test — so a point cannot
 * widen the limits it is being judged against.
 */
export function buildMonthOverMonthRow(input: MonthOverMonthInput): MonthOverMonthRow {
  const { key, label, higherIsBetter, series } = input
  const unit = input.unit ?? ''

  const base = {
    key, label, unit,
    current: 0, previous: 0, delta: 0, deltaPct: null as number | null,
    direction: 'flat' as WeatherDirection, tone: 'neutral' as WeatherTone,
    significant: false,
    currentMonth: null as string | null,
    previousMonth: null as string | null,
  }

  if (series.length < 2) {
    return { ...base, suppressed: 'no_comparison_month' }
  }

  const currentBucket = series[series.length - 1]
  const previousBucket = series[series.length - 2]
  const current = currentBucket.count
  const previous = previousBucket.count
  const delta = current - previous
  const direction: WeatherDirection = current > previous ? 'up' : current < previous ? 'down' : 'flat'

  // Guard the percentage against a tiny baseline, not just zero — 1 -> 3 is a
  // "+200%" that means nothing at these counts.
  const deltaPct = previous < 5 ? null : round1((delta / previous) * 100)

  const shaped = {
    ...base,
    current, previous, delta, deltaPct, direction,
    currentMonth: currentBucket.month,
    previousMonth: previousBucket.month,
  }

  if (current + previous < MOM_MIN_COMBINED) {
    return { ...shaped, suppressed: 'insufficient_events' }
  }
  if (series.length < MOM_MIN_HISTORY) {
    return { ...shaped, suppressed: 'insufficient_history' }
  }

  const priorCounts = series.slice(0, -1).map(b => b.count)
  const limits = cChartLimits(priorCounts)
  if (!limits) {
    return { ...shaped, suppressed: 'insufficient_history' }
  }

  const significant = current > limits.ucl || current < limits.lcl
  let tone: WeatherTone = 'neutral'
  if (significant && higherIsBetter !== null && direction !== 'flat') {
    const improved = direction === 'up' ? higherIsBetter : !higherIsBetter
    tone = improved ? 'good' : 'bad'
  }

  return { ...shaped, significant, tone, suppressed: null }
}

/** "June vs May" style label for a compared pair. Null when nothing to compare. */
export function formatComparedMonths(row: MonthOverMonthRow): string | null {
  if (!row.currentMonth || !row.previousMonth) return null
  const name = (key: string): string => {
    const [y, m] = key.split('-').map(Number)
    if (!y || !m) return key
    return new Date(Date.UTC(y, m - 1, 1))
      .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  }
  return `${name(row.currentMonth)} vs ${name(row.previousMonth)}`
}
