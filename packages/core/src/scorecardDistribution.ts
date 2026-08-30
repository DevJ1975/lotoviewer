// Single source of truth for the EHS scorecard's recordable-count distribution.
// Both the Excel "Distribution" tab (apps/web/lib/scorecardWorkbook.ts) and the
// PDF distribution section (apps/web/lib/pdfScorecard.ts) render this exact
// summary, so the two exports can never disagree to the digit.
//
// Monthly recordable counts are rare events, so they are summarized with a
// c-chart (mean ±3σ) and a Poisson forecast — NOT a Gaussian bell. Every field
// is null when there isn't enough data (the surfaces render "—"/"insufficient"
// rather than a fabricated number).

import { mean, median, stdDev, coefficientOfVariation, skewness } from './statistics'
import { cChartLimits, forecastCount, type ControlLimits, type CountForecast } from './forecast'

export interface RecordableDistribution {
  /** Months observed. */
  n: number
  mean: number | null
  median: number | null
  stdDev: number | null
  /** Coefficient of variation (stdDev/mean). */
  cv: number | null
  skewness: number | null
  min: number | null
  max: number | null
  /** c-chart control limits; null when fewer than 2 months. */
  cChart: ControlLimits | null
  /** Next-month Poisson forecast; null when fewer than 6 months. */
  forecast: CountForecast | null
}

/**
 * Descriptive + control-chart + forecast summary of a monthly recordable-count
 * series. Pure: same input → same output. Callers gate the full table on `n >= 2`
 * (below that only `n` is meaningful) and render "—" for any null field.
 */
export function summarizeRecordableDistribution(counts: readonly number[]): RecordableDistribution {
  const n = counts.length
  return {
    n,
    mean: mean(counts),
    median: median(counts),
    stdDev: stdDev(counts),
    cv: coefficientOfVariation(counts),
    skewness: skewness(counts),
    min: n > 0 ? Math.min(...counts) : null,
    max: n > 0 ? Math.max(...counts) : null,
    cChart: cChartLimits(counts),
    forecast: forecastCount(counts),
  }
}
