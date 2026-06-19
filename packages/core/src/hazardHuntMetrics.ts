// Hazard Hunt intelligence aggregator. Turns a flat list of findings plus the
// run-cadence counters into the leading-indicator shape the home dashboard and
// the in-app Data Scientist agent both read.
//
// Same posture as riskMetrics / nearMissMetrics / incidentScorecardMetrics: a
// pure, deterministic summarizer with no I/O, no DOM, no Node. The DS agent
// NARRATES these numbers in plain language — it never computes them. Keeping
// the math here (and out of any LLM call) is what makes the figures auditable
// and reproducible run-to-run.

import {
  HAZARD_HUNT_HAZARD_CATEGORIES,
  HAZARD_HUNT_RESOLVED_STATUSES,
  cadenceAdherence,
  type HazardCategory,
  type HazardHuntFindingStatus,
} from './hazardHunt'

// ──────────────────────────────────────────────────────────────────────────
// Input shapes — the minimal subset of a finding the metrics depend on.
// ──────────────────────────────────────────────────────────────────────────

export interface HazardHuntFindingInput {
  hazardCategory: HazardCategory
  status:         HazardHuntFindingStatus
  /** When the finding was raised. ISO 8601 instant. */
  createdAt:      string
}

export interface HazardHuntMetricsInput {
  findings:       HazardHuntFindingInput[]
  /** Runs that came due / were generated in the window. */
  huntsGenerated: number
  /** Runs that were actually submitted in the window. */
  huntsCompleted: number
  /**
   * Length of one trend bucket in days (default 90). The recent bucket is the
   * most recent `windowDays`; the prior bucket is the `windowDays` before that.
   */
  windowDays?:    number
  /** "Now" for the trend split. ISO 8601 instant; defaults to the call time. */
  asOf?:          string
}

// ──────────────────────────────────────────────────────────────────────────
// Result shapes
// ──────────────────────────────────────────────────────────────────────────

export interface CategoryCount {
  category: HazardCategory
  count:    number
}

export interface HazardHuntMetrics {
  totalFindings:    number
  openFindings:     number
  /** Findings that are closed or escalated (per HAZARD_HUNT_RESOLVED_STATUSES). */
  resolvedFindings: number
  /** Completed/generated run ratio, 0..1 (reuses cadenceAdherence). */
  cadenceAdherence: number
  /** All 9 categories, zero-filled, count desc then category name asc. */
  byCategory:       CategoryCount[]
  /** The categories with count > 0, top 3 by the same ordering. */
  topCategories:    CategoryCount[]
  /**
   * Findings opened in the recent window vs the prior window, and the change.
   * `delta = recentOpened - priorOpened` (positive ⇒ more findings recently).
   */
  trend:            { recentOpened: number; priorOpened: number; delta: number }
}

// ──────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000
const DEFAULT_WINDOW_DAYS = 90

// A finding counts as "resolved" once it is closed out or promoted into the
// risk register — the same definition the cadence/proactive indicator uses.
const RESOLVED_STATUSES = new Set<HazardHuntFindingStatus>(HAZARD_HUNT_RESOLVED_STATUSES)

/** All 9 categories pre-seeded to zero so the breakdown is always dense. */
function zeroCategoryCounts(): Map<HazardCategory, number> {
  return new Map(HAZARD_HUNT_HAZARD_CATEGORIES.map(category => [category, 0]))
}

/**
 * Categories ordered by count desc, with a stable secondary sort by category
 * name asc so equal counts have one deterministic ordering (the alphabetical
 * tie-break, not input order).
 */
function rankCategories(counts: Map<HazardCategory, number>): CategoryCount[] {
  return Array.from(counts, ([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

/** Findings whose createdAt falls in the half-open window (fromMs, toMs]. */
function countOpenedInWindow(
  findings: ReadonlyArray<HazardHuntFindingInput>,
  fromMs: number,
  toMs: number,
): number {
  let n = 0
  for (const f of findings) {
    const ms = Date.parse(f.createdAt)
    if (Number.isNaN(ms)) continue
    if (ms > fromMs && ms <= toMs) n += 1
  }
  return n
}

// ──────────────────────────────────────────────────────────────────────────
// Summarizer
// ──────────────────────────────────────────────────────────────────────────

/**
 * Aggregate a tenant's Hazard Hunt findings + run counters into the dashboard
 * KPI shape. Pure and deterministic — given the same input (including `asOf`
 * and `windowDays`) it always returns the same result, which is what lets the
 * DS agent quote these numbers verbatim and what makes the trend unit-testable.
 *
 * The trend uses two adjacent, half-open buckets anchored on `asOf`:
 *   • recent = (asOf − windowDays, asOf]
 *   • prior  = (asOf − 2·windowDays, asOf − windowDays]
 * so a finding is counted in at most one bucket and `asOf` itself lands in the
 * recent bucket.
 *
 * Empty input is handled gracefully: zero counts everywhere, a vacuously
 * perfect cadence of 1 (nothing scheduled ⇒ nothing missed), and no NaN.
 */
export function summarizeHazardHuntMetrics(input: HazardHuntMetricsInput): HazardHuntMetrics {
  const { findings, huntsGenerated, huntsCompleted } = input
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS
  const asOfMs = input.asOf ? Date.parse(input.asOf) : Date.now()

  const counts = zeroCategoryCounts()
  let openFindings = 0
  let resolvedFindings = 0
  for (const f of findings) {
    counts.set(f.hazardCategory, (counts.get(f.hazardCategory) ?? 0) + 1)
    if (f.status === 'open') openFindings += 1
    if (RESOLVED_STATUSES.has(f.status)) resolvedFindings += 1
  }

  const byCategory = rankCategories(counts)

  const windowMs = windowDays * DAY_MS
  const recentOpened = countOpenedInWindow(findings, asOfMs - windowMs, asOfMs)
  const priorOpened = countOpenedInWindow(findings, asOfMs - 2 * windowMs, asOfMs - windowMs)

  return {
    totalFindings:    findings.length,
    openFindings,
    resolvedFindings,
    cadenceAdherence: cadenceAdherence(huntsGenerated, huntsCompleted),
    byCategory,
    topCategories:    byCategory.filter(c => c.count > 0).slice(0, 3),
    trend:            { recentOpened, priorOpened, delta: recentOpened - priorOpened },
  }
}
