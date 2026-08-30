// Pure statistics utilities for the EHS analytics surfaces. No I/O, no DOM,
// fully unit-testable. Every function returns `null` (or a zeroed interval)
// rather than NaN when there is not enough data to answer honestly — the same
// "render '—' on insufficient data" contract used across the metrics layer
// (e.g. incidentScorecardMetrics rate helpers, insightsMetrics computeStat).
//
// Design notes / why these specific functions:
//   - A Gaussian bell is the WRONG model for most safety metrics, so this
//     module deliberately also ships Poisson (rare counts) and Wilson
//     (binomial proportions) helpers, not just normalPdf. The distribution UI
//     picks the right one per metric.
//   - Sample (n-1) variance/stdDev matches insightsMetrics.computeStat.
//   - quantile uses the type-7 rule (Excel/NumPy default) so percentiles match
//     what an analyst computes in a spreadsheet.

export interface Histogram {
  bins: Array<{ lo: number; hi: number; count: number; density: number }>
  binWidth: number
  n: number
}

export interface LinearFit {
  slope: number
  intercept: number
  /** Coefficient of determination, 0..1. */
  r2: number
  n: number
}

export interface ConfidenceInterval {
  point: number
  lower: number
  upper: number
}

// ── Central tendency & spread ───────────────────────────────────────────────

/** Arithmetic mean. Null for an empty array. */
export function mean(xs: readonly number[]): number | null {
  if (xs.length === 0) return null
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Sample variance (n-1 denominator). Null when n < 2. */
export function variance(xs: readonly number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const m = mean(xs)!
  let ss = 0
  for (const x of xs) ss += (x - m) ** 2
  return ss / (n - 1)
}

/** Sample standard deviation (n-1). Null when n < 2. */
export function stdDev(xs: readonly number[]): number | null {
  const v = variance(xs)
  return v === null ? null : Math.sqrt(v)
}

/** p-quantile (0..1) via type-7 linear interpolation. Null for empty input. */
export function quantile(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const clamped = Math.max(0, Math.min(1, p))
  const h = (sorted.length - 1) * clamped
  const lo = Math.floor(h)
  const frac = h - lo
  const a = sorted[lo]!
  const b = sorted[lo + 1] ?? a
  return a + frac * (b - a)
}

/** Median (robust to skew/outliers). Null for empty input. */
export function median(xs: readonly number[]): number | null {
  return quantile(xs, 0.5)
}

/** Percentile convenience: percentile(xs, 95) === quantile(xs, 0.95). */
export function percentile(xs: readonly number[], pct: number): number | null {
  return quantile(xs, pct / 100)
}

/** Coefficient of variation = stdDev/mean. Null when n<2 or |mean|≈0. */
export function coefficientOfVariation(xs: readonly number[]): number | null {
  const m = mean(xs)
  const sd = stdDev(xs)
  if (m === null || sd === null || Math.abs(m) < 1e-12) return null
  return sd / m
}

/** Fisher–Pearson sample skewness. Null when n < 3 or zero spread. */
export function skewness(xs: readonly number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const m = mean(xs)!
  const sd = stdDev(xs)!
  if (sd < 1e-12) return null
  let s = 0
  for (const x of xs) s += ((x - m) / sd) ** 3
  // Adjusted Fisher–Pearson standardized moment.
  return (n / ((n - 1) * (n - 2))) * s
}

// ── Binning & density ───────────────────────────────────────────────────────

/**
 * Histogram with Freedman–Diaconis bin width (2·IQR·n^(-1/3)); falls back to
 * Sturges (ceil(log2 n)+1 bins) when IQR is 0 (heavily tied/discrete data).
 * `opts.binCount` overrides the rule. Empty histogram when n < 2. Densities are
 * count/(n·binWidth) so they integrate to ~1 and overlay a fitted normalPdf.
 */
export function histogram(xs: readonly number[], opts?: { binCount?: number }): Histogram {
  const n = xs.length
  if (n < 2) return { bins: [], binWidth: 0, n }
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  if (hi === lo) {
    // All identical — a single unit-width bin centered on the value.
    return { bins: [{ lo, hi: lo + 1, count: n, density: 1 }], binWidth: 1, n }
  }

  let binCount: number
  if (opts?.binCount && opts.binCount > 0) {
    binCount = Math.floor(opts.binCount)
  } else {
    const iqr = (quantile(xs, 0.75)! - quantile(xs, 0.25)!)
    const fdWidth = iqr > 0 ? 2 * iqr * Math.pow(n, -1 / 3) : 0
    binCount = fdWidth > 0
      ? Math.max(1, Math.ceil((hi - lo) / fdWidth))
      : Math.ceil(Math.log2(n)) + 1 // Sturges fallback
  }
  binCount = Math.max(1, binCount)

  const binWidth = (hi - lo) / binCount
  const bins = Array.from({ length: binCount }, (_, i) => ({
    lo: lo + i * binWidth,
    hi: lo + (i + 1) * binWidth,
    count: 0,
    density: 0,
  }))
  for (const x of xs) {
    // Last bin is inclusive of the max so it isn't dropped.
    const idx = Math.min(binCount - 1, Math.floor((x - lo) / binWidth))
    bins[idx]!.count += 1
  }
  for (const b of bins) b.density = b.count / (n * binWidth)
  return { bins, binWidth, n }
}

/** Normal probability density at x. 0 when sd <= 0. For overlaying a fitted bell. */
export function normalPdf(x: number, mu: number, sd: number): number {
  if (sd <= 0) return 0
  const z = (x - mu) / sd
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI))
}

/** Standard score (x-mean)/sd. Null when sd <= 0. */
export function zScore(x: number, mu: number, sd: number): number | null {
  if (sd <= 0) return null
  return (x - mu) / sd
}

// ── Counts / rates ──────────────────────────────────────────────────────────

function lnFactorial(k: number): number {
  let s = 0
  for (let i = 2; i <= k; i++) s += Math.log(i)
  return s
}

/** Poisson PMF P(X=k | lambda) for integer k>=0, lambda>=0. Log-space for stability. */
export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isInteger(k) || k < 0 || lambda < 0) return 0
  if (lambda === 0) return k === 0 ? 1 : 0
  const logP = -lambda + k * Math.log(lambda) - lnFactorial(k)
  return Math.exp(logP)
}

/**
 * Wilson score interval for a binomial proportion (successes/trials). The honest
 * interval for on-time%, RCA%, fail-rate. Returns a zeroed interval when
 * trials === 0 (caller renders "—"). point/lower/upper are proportions in 0..1.
 */
export function wilsonInterval(successes: number, trials: number, z = 1.96): ConfidenceInterval {
  if (trials <= 0) return { point: 0, lower: 0, upper: 0 }
  const p = successes / trials
  const n = trials
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { point: p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) }
}

/**
 * Normal-approximation confidence interval for a Poisson COUNT (rare events):
 * count ± z·√count, lower floored at 0. Same form as the Poisson prediction
 * interval in forecast.ts. Approximate for very small counts — its purpose is
 * to show that a headline built on a handful of events is not precise.
 */
export function poissonCountInterval(count: number, z = 1.96): ConfidenceInterval {
  const c = Math.max(0, count)
  const half = z * Math.sqrt(c)
  return { point: c, lower: Math.max(0, c - half), upper: c + half }
}

/**
 * Confidence interval for an OSHA-style rate = count · base / hours. The count
 * is Poisson, so the rate interval is the count interval scaled by base/hours.
 * Null when hours <= 0 (caller renders "—"). This is what turns "TRIR 1.33"
 * into "TRIR 1.33 (0.2–3.9)" and stops a 1-recordable tenant reading as precise.
 */
export function rateInterval(count: number, hours: number, base = 200_000, z = 1.96): ConfidenceInterval | null {
  if (hours <= 0) return null
  const ci = poissonCountInterval(count, z)
  const scale = base / hours
  return { point: ci.point * scale, lower: ci.lower * scale, upper: ci.upper * scale }
}

// ── Smoothing & trend ───────────────────────────────────────────────────────

/**
 * Exponentially weighted moving average. alpha in (0,1]; higher = more reactive.
 * Same-length output (first element = first input). Empty in → empty out.
 */
export function ewma(xs: readonly number[], alpha: number): number[] {
  if (xs.length === 0) return []
  const a = Math.max(1e-6, Math.min(1, alpha))
  const out: number[] = [xs[0]!]
  for (let i = 1; i < xs.length; i++) out.push(a * xs[i]! + (1 - a) * out[i - 1]!)
  return out
}

/**
 * Ordinary least squares of y on x. Null when n < 2 or x has zero variance.
 * r2 quantifies fit quality (callers gate trend claims on it, e.g. r2 >= 0.3).
 */
export function linearRegression(x: readonly number[], y: readonly number[]): LinearFit | null {
  const n = Math.min(x.length, y.length)
  if (n < 2) return null
  const mx = mean(x.slice(0, n))!
  const my = mean(y.slice(0, n))!
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx
    const dy = y[i]! - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy)
  return { slope, intercept, r2, n }
}

// ── Correlation ─────────────────────────────────────────────────────────────

/** Pearson r between two equal-length series. Null when n<3 or zero variance. */
export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  const mx = mean(x.slice(0, n))!
  const my = mean(y.slice(0, n))!
  let sxx = 0, sxy = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx
    const dy = y[i]! - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * Cross-correlation of x against y at integer lag k (x leads y by k periods).
 * Aligns the overlapping window then calls pearson. Null when overlap < 3.
 */
export function laggedCorrelation(x: readonly number[], y: readonly number[], lag: number): number | null {
  if (lag >= 0) {
    const overlap = Math.min(x.length, y.length - lag)
    if (overlap < 3) return null
    return pearson(x.slice(0, overlap), y.slice(lag, lag + overlap))
  }
  const m = -lag
  const overlap = Math.min(x.length - m, y.length)
  if (overlap < 3) return null
  return pearson(x.slice(m, m + overlap), y.slice(0, overlap))
}
