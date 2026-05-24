// EHS scorecard goals — pure metric metadata + evaluation helpers.
//
// The ehs_scorecard_targets table stores both a tenant's goals
// (kind='target', per metric per year) and its industry-benchmark
// overrides (kind='benchmark', per metric). This module owns the
// domain facts about each metric (label, direction-of-goodness, whether
// an industry benchmark exists) and the small pure functions that turn a
// current value + a target/benchmark into a verdict. Supabase reads and
// writes live at the call site, where the auth session is available.

export type TargetMetric =
  | 'trir'
  | 'dart'
  | 'recordables'
  | 'capa_on_time_pct'
  | 'rca_completion_pct'

export const TARGET_METRICS: readonly TargetMetric[] = [
  'trir', 'dart', 'recordables', 'capa_on_time_pct', 'rca_completion_pct',
] as const

export interface TargetMetricMeta {
  label: string
  /** Goal direction: true when a smaller value is better (rates, counts);
   *  false when a larger value is better (the leading percentages). */
  lowerIsBetter: boolean
  /** Whether an embedded BLS industry benchmark exists for this metric. */
  hasBenchmark: boolean
}

export const TARGET_METRIC_META: Record<TargetMetric, TargetMetricMeta> = {
  trir:               { label: 'TRIR',           lowerIsBetter: true,  hasBenchmark: true },
  dart:               { label: 'DART',           lowerIsBetter: true,  hasBenchmark: true },
  recordables:        { label: 'Recordables',    lowerIsBetter: true,  hasBenchmark: false },
  capa_on_time_pct:   { label: 'CAPA on time',   lowerIsBetter: false, hasBenchmark: false },
  rca_completion_pct: { label: 'RCA completion', lowerIsBetter: false, hasBenchmark: false },
}

export interface TargetVerdict {
  /** True when the current value meets or beats the target. */
  onTrack: boolean
  /** Signed % difference of current vs target (current relative to target).
   *  Positive means current is above the target value, negative below.
   *  Null when the target is 0 (can't divide) or the current value is null. */
  deltaPct: number | null
}

/**
 * Compare a current metric value against a goal. `lowerIsBetter` flips the
 * on-track test: a rate is on track when at-or-below target; a percentage
 * is on track when at-or-above target.
 */
export function evaluateTarget(
  current: number | null,
  target: number,
  lowerIsBetter: boolean,
): TargetVerdict {
  if (current === null) return { onTrack: false, deltaPct: null }
  const onTrack = lowerIsBetter ? current <= target : current >= target
  const deltaPct = target === 0 ? null : ((current - target) / target) * 100
  return { onTrack, deltaPct }
}

export interface BenchmarkVerdict {
  /** True when the tenant's value is at-or-better than the industry rate.
   *  Benchmarks apply to TRIR/DART, where lower is better. */
  betterThanIndustry: boolean
  /** Signed % difference of current vs the industry rate. Negative means
   *  below (better than) the industry average. Null when industry is 0 or
   *  current is null. */
  deltaPct: number | null
}

/**
 * Compare a current rate (TRIR/DART) against an industry benchmark, where
 * lower is better.
 */
export function compareToBenchmark(
  current: number | null,
  industry: number,
): BenchmarkVerdict {
  if (current === null) return { betterThanIndustry: false, deltaPct: null }
  const deltaPct = industry === 0 ? null : ((current - industry) / industry) * 100
  return { betterThanIndustry: current <= industry, deltaPct }
}
