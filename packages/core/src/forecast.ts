// Transparent, deterministic forecasting + control-chart helpers for the EHS
// scorecard. No I/O, no DOM, no LLM — same input always yields the same number,
// so the "where things are going" widgets are auditable. Consumes the pure
// statistics utilities. The number is never produced by AI (the AI layer only
// narrates these results).
//
// Methods are intentionally simple and explained inline:
//   - Counts (recordables, near-miss) are rare-event Poisson, so the prediction
//     interval is Poisson (λ ± z·√λ), NOT a symmetric Gaussian band, and the
//     control chart is a c-chart (the safety profession's standard for counts).
//   - A trend term is only applied when the linear fit is good enough
//     (r² ≥ TREND_R2_MIN); otherwise we project a flat run-rate and say so.

import { ewma, linearRegression } from './statistics'
import { OSHA_RATE_CONSTANT } from './oshaForms'

const DEFAULT_ALPHA = 0.3
const TREND_R2_MIN = 0.3
const MIN_FORECAST_POINTS = 6
const Z95 = 1.96

export interface CountForecast {
  /** Point forecast for the next period (clamped ≥ 0 — counts can't be negative). */
  expected: number
  /** Poisson 95% prediction interval. */
  lower: number
  upper: number
  /** Per-period trend (0 when the trend isn't statistically reliable). */
  trendSlope: number
  /** Linear-fit quality, 0..1. */
  r2: number
  /** True when r² ≥ threshold and the slope term was applied. */
  hasTrend: boolean
  /** Number of periods the forecast is based on. */
  basis: number
}

/**
 * Forecast the next period's count from a monthly series (e.g. recordables).
 * EWMA level + a reliability-gated linear trend, with a Poisson prediction
 * interval. Null when there are fewer than MIN_FORECAST_POINTS points — the UI
 * then shows "not enough history" rather than a fabricated projection.
 */
export function forecastCount(counts: readonly number[], opts?: { alpha?: number }): CountForecast | null {
  if (counts.length < MIN_FORECAST_POINTS) return null
  const level = ewma(counts, opts?.alpha ?? DEFAULT_ALPHA).at(-1)!
  const idx = counts.map((_, i) => i)
  const fit = linearRegression(idx, counts)
  const hasTrend = fit !== null && fit.r2 >= TREND_R2_MIN
  const trendSlope = hasTrend ? fit!.slope : 0
  const expected = Math.max(0, level + trendSlope)
  const halfWidth = Z95 * Math.sqrt(expected)
  return {
    expected,
    lower: Math.max(0, expected - halfWidth),
    upper: expected + halfWidth,
    trendSlope,
    r2: fit?.r2 ?? 0,
    hasTrend,
    basis: counts.length,
  }
}

// ── Control charts ──────────────────────────────────────────────────────────

export interface ControlLimits {
  centerLine: number
  ucl: number
  lcl: number
}

/**
 * c-chart limits for a count series with (assumed) equal exposure per period —
 * the standard chart for monthly recordable/near-miss counts. CL = c̄,
 * UCL/LCL = c̄ ± 3√c̄ (LCL floored at 0). Null when fewer than 2 points.
 */
export function cChartLimits(counts: readonly number[]): ControlLimits | null {
  if (counts.length < 2) return null
  const cBar = counts.reduce((s, c) => s + c, 0) / counts.length
  const sigma3 = 3 * Math.sqrt(cBar)
  return { centerLine: cBar, ucl: cBar + sigma3, lcl: Math.max(0, cBar - sigma3) }
}

/**
 * p-chart limits for a proportion (successes/trials), e.g. CAPA on-time %.
 * CL = p̄, UCL/LCL = p̄ ± 3√(p̄(1-p̄)/n), bounded to [0,1]. Proportions in 0..1.
 * Null when trials <= 0.
 */
export function pChartLimits(successes: number, trials: number): ControlLimits | null {
  if (trials <= 0) return null
  const p = successes / trials
  const sigma3 = 3 * Math.sqrt((p * (1 - p)) / trials)
  return { centerLine: p, ucl: Math.min(1, p + sigma3), lcl: Math.max(0, p - sigma3) }
}

// ── Annualized TRIR run-rate ────────────────────────────────────────────────

export interface TrirProjection {
  /** Year-end TRIR if the current pace holds. Null when hours are missing. */
  projectedTrir: number | null
  target: number | null
  benchmark: number | null
  /** projectedTrir <= target. Null when either is missing. */
  onTrack: boolean | null
  /** False early in the year or with too few cases — the projection is volatile. */
  reliable: boolean
}

/**
 * Project year-end TRIR from year-to-date figures. The YTD rate *is* the
 * run-rate (the year fraction cancels), so this is an honest "if this pace
 * holds" extrapolation, flagged unreliable before 25% of the year or with < 3
 * recordables (a tiny, volatile numerator).
 */
export function projectAnnualTrir(args: {
  ytdRecordables: number
  ytdHours: number
  fractionOfYearElapsed: number
  target?: number | null
  benchmark?: number | null
}): TrirProjection {
  const { ytdRecordables, ytdHours, fractionOfYearElapsed } = args
  const target = args.target ?? null
  const benchmark = args.benchmark ?? null
  const projectedTrir = ytdHours > 0 ? (ytdRecordables * OSHA_RATE_CONSTANT) / ytdHours : null
  const reliable = fractionOfYearElapsed >= 0.25 && ytdRecordables >= 3
  const onTrack = projectedTrir !== null && target !== null ? projectedTrir <= target : null
  return { projectedTrir, target, benchmark, onTrack, reliable }
}

// ── Trend assessment / "on track?" ──────────────────────────────────────────

export type TrendStatus = 'improving' | 'worsening' | 'flat'

export interface TrendAssessment {
  status: TrendStatus
  /** Per-period slope (0 when not reliable). */
  slope: number
  /** True when the linear fit is good enough to claim a direction. */
  reliable: boolean
  /** Estimated periods to reach the target, when moving toward it; else null. */
  etaPeriods: number | null
}

/**
 * Classify where a series is heading relative to a goal. Only claims a direction
 * when the linear fit is reliable (r² ≥ threshold); otherwise 'flat'. ETA is
 * shown only when the trend is moving toward the target.
 */
export function assessTrend(
  series: readonly number[],
  opts: { lowerIsBetter: boolean; target?: number | null },
): TrendAssessment | null {
  if (series.length < MIN_FORECAST_POINTS) return null
  const idx = series.map((_, i) => i)
  const fit = linearRegression(idx, series)
  const reliable = fit !== null && fit.r2 >= TREND_R2_MIN
  const slope = reliable ? fit!.slope : 0
  let status: TrendStatus = 'flat'
  if (reliable && slope !== 0) {
    const improving = opts.lowerIsBetter ? slope < 0 : slope > 0
    status = improving ? 'improving' : 'worsening'
  }

  let etaPeriods: number | null = null
  const target = opts.target ?? null
  if (reliable && slope !== 0 && target !== null) {
    const level = ewma(series, DEFAULT_ALPHA).at(-1)!
    const gap = target - level
    const eta = gap / slope
    // Only meaningful when the slope moves the level toward the target.
    if (eta > 0 && Number.isFinite(eta)) etaPeriods = eta
  }
  return { status, slope, reliable, etaPeriods }
}
