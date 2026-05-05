// Risk Assessment intelligence aggregator. Reads the active
// tenant's risks (RLS-scoped via the registered Supabase client)
// and computes the leading indicators from PDD §12.1.
//
// Pure helpers are exported alongside fetchRiskMetrics() so we can
// test the math without hitting a database.

import { supabase } from './supabaseClient'
import { HIERARCHY_ORDER, type Band, type HierarchyLevel } from './risk'
import type { HazardCategory, RiskStatus } from './queries/risks'

// ──────────────────────────────────────────────────────────────────────────
// Result shapes
// ──────────────────────────────────────────────────────────────────────────

export interface RiskMetrics {
  /** Total non-closed risks under the active tenant. */
  totalActive:                number
  /** Total risks (including closed) — denominator for some KPIs. */
  totalAll:                   number
  /** Distribution by residual band (or inherent if residual is null). */
  byEffectiveBand:            Record<Band, number>
  /** Risks where next_review_date < today AND status is not closed/exception. */
  overdueReviewCount:         number
  /** High/Extreme effective-band risks where the status is still 'open'
   *  AND no controls have been attached yet — a "needs attention" cohort. */
  highOrExtremeWithoutPlan:   number
  /** Count of risks where each hierarchy level is the HIGHEST applied. */
  hierarchyDistribution:      Record<HierarchyLevel, number> & { none: number }
  /** Top N risks ranked by residual_score desc (or inherent_score
   *  when residual is null). */
  topResidualRisks:           TopRiskRow[]
}

export interface TopRiskRow {
  id:             string
  risk_number:    string
  title:          string
  effective_band: Band
  effective_score: number
  status:         RiskStatus
  hazard_category: HazardCategory
}

// ──────────────────────────────────────────────────────────────────────────
// Pure aggregation helpers — no DB calls, fully testable
// ──────────────────────────────────────────────────────────────────────────

export interface RiskRowForMetrics {
  id:                  string
  risk_number:         string
  title:               string
  status:              RiskStatus
  hazard_category:     HazardCategory
  inherent_score:      number
  inherent_band:       Band
  residual_score:      number | null
  residual_band:       Band | null
  next_review_date:    string | null
}

export interface RiskControlForMetrics {
  risk_id:         string
  hierarchy_level: HierarchyLevel
}

const ZERO_BAND_DIST = (): Record<Band, number> => ({
  low: 0, moderate: 0, high: 0, extreme: 0,
})

const ZERO_HIERARCHY_DIST = (): Record<HierarchyLevel, number> & { none: number } => ({
  elimination: 0, substitution: 0, engineering: 0, administrative: 0, ppe: 0, none: 0,
})

/** Highest applied control level per risk; null if no controls. */
export function highestAppliedControlByRisk(
  controls: RiskControlForMetrics[],
): Map<string, HierarchyLevel | null> {
  const out = new Map<string, HierarchyLevel | null>()
  for (const c of controls) {
    const cur = out.get(c.risk_id) ?? null
    if (cur === null) {
      out.set(c.risk_id, c.hierarchy_level)
      continue
    }
    // Pick the more-effective level (lower index in HIERARCHY_ORDER).
    if (HIERARCHY_ORDER.indexOf(c.hierarchy_level) < HIERARCHY_ORDER.indexOf(cur)) {
      out.set(c.risk_id, c.hierarchy_level)
    }
  }
  return out
}

/** Distribution by residual band (or inherent when residual is null). */
export function computeBandDistribution(risks: RiskRowForMetrics[]): Record<Band, number> {
  const out = ZERO_BAND_DIST()
  for (const r of risks) {
    const band = (r.residual_band ?? r.inherent_band) as Band
    out[band] += 1
  }
  return out
}

/**
 * Hierarchy distribution: for every active risk, what's the highest
 * control level applied? "none" bucket counts risks with no controls.
 */
export function computeHierarchyDistribution(
  risks: RiskRowForMetrics[],
  controls: RiskControlForMetrics[],
): Record<HierarchyLevel, number> & { none: number } {
  const top = highestAppliedControlByRisk(controls)
  const out = ZERO_HIERARCHY_DIST()
  for (const r of risks) {
    const level = top.get(r.id) ?? null
    if (level === null) out.none += 1
    else                out[level] += 1
  }
  return out
}

/**
 * Count of risks where next_review_date is in the past, excluding
 * closed / accepted-exception statuses (those don't have a review
 * cadence).
 */
export function computeOverdueReviewCount(
  risks: RiskRowForMetrics[],
  now:   Date = new Date(),
): number {
  const todayIso = now.toISOString().slice(0, 10)
  let count = 0
  for (const r of risks) {
    if (r.status === 'closed' || r.status === 'accepted_exception') continue
    if (!r.next_review_date) continue
    if (r.next_review_date < todayIso) count += 1
  }
  return count
}

/**
 * Risks in High or Extreme effective band that are still 'open' AND
 * have zero controls attached. The "controls-needed" cohort surfaced
 * on the home dashboard.
 */
export function computeHighOrExtremeWithoutPlan(
  risks:    RiskRowForMetrics[],
  controls: RiskControlForMetrics[],
): number {
  const hasControl = new Set(controls.map(c => c.risk_id))
  let count = 0
  for (const r of risks) {
    if (r.status !== 'open') continue
    const band = (r.residual_band ?? r.inherent_band) as Band
    if (band !== 'high' && band !== 'extreme') continue
    if (hasControl.has(r.id)) continue
    count += 1
  }
  return count
}

/**
 * Top N risks ranked by effective score (residual when present,
 * inherent otherwise) desc. Closed / accepted-exception risks are
 * excluded — they're not actionable.
 */
export function computeTopResidualRisks(
  risks: RiskRowForMetrics[],
  n:     number = 5,
): TopRiskRow[] {
  return risks
    .filter(r => r.status !== 'closed' && r.status !== 'accepted_exception')
    .map((r): TopRiskRow => ({
      id:              r.id,
      risk_number:     r.risk_number,
      title:           r.title,
      effective_band:  (r.residual_band ?? r.inherent_band) as Band,
      effective_score: r.residual_score ?? r.inherent_score,
      status:          r.status,
      hazard_category: r.hazard_category,
    }))
    .sort((a, b) => b.effective_score - a.effective_score)
    .slice(0, n)
}

// ──────────────────────────────────────────────────────────────────────────
// DB fetcher — reads the active tenant's data via the registered client
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pulls the active tenant's risks + risk_controls (RLS scopes both)
 * and computes every KPI in one round-trip-pair. Returns null when
 * the user has no active tenant or RLS denies access — caller hides
 * the panel rather than rendering an error.
 */
export async function fetchRiskMetrics(): Promise<RiskMetrics | null> {
  const [risksRes, controlsRes] = await Promise.all([
    supabase
      .from('risks')
      .select('id, risk_number, title, status, hazard_category, inherent_score, inherent_band, residual_score, residual_band, next_review_date'),
    supabase
      .from('risk_controls')
      .select('risk_id, hierarchy_level'),
  ])

  if (risksRes.error || controlsRes.error) {
    console.warn('[riskMetrics] fetch failed', risksRes.error ?? controlsRes.error)
    return null
  }

  const allRisks = (risksRes.data ?? []) as unknown as RiskRowForMetrics[]
  const controls = (controlsRes.data ?? []) as unknown as RiskControlForMetrics[]

  // "Active" = anything not closed / accepted-exception (those are
  // out of the live register from a KPI perspective).
  const activeRisks = allRisks.filter(
    r => r.status !== 'closed' && r.status !== 'accepted_exception',
  )

  return {
    totalActive:              activeRisks.length,
    totalAll:                 allRisks.length,
    byEffectiveBand:          computeBandDistribution(activeRisks),
    overdueReviewCount:       computeOverdueReviewCount(activeRisks),
    highOrExtremeWithoutPlan: computeHighOrExtremeWithoutPlan(activeRisks, controls),
    hierarchyDistribution:    computeHierarchyDistribution(activeRisks, controls),
    topResidualRisks:         computeTopResidualRisks(activeRisks, 5),
  }
}
