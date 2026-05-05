// JHA intelligence aggregator. Reads the active tenant's JHAs +
// hazards (RLS-scoped via the registered Supabase client) and
// computes leading-indicator counts for the home dashboard.

import { supabase } from './supabaseClient'
import {
  highestPotentialSeverity,
  countPpeAloneWarnings,
  type JhaSeverity,
  type JhaStatus,
  type JhaHazard,
  type JhaHazardControl,
} from './jha'

// ──────────────────────────────────────────────────────────────────────────
// Result shapes
// ──────────────────────────────────────────────────────────────────────────

export interface JhaMetrics {
  /** JHAs in any non-superseded status. */
  totalActive:           number
  /** Total JHAs (any status) — denominator. */
  totalAll:              number
  /** Status distribution across active JHAs. */
  byStatus:              Record<JhaStatus, number>
  /** JHAs currently in 'in_review' — awaiting approval. */
  awaitingApproval:      number
  /** Approved JHAs whose next_review_date has passed. */
  overdueReview:         number
  /** Hazards with potential_severity 'high' or 'extreme' across the
   *  active register — leading indicator for the controls program. */
  highOrExtremeHazards:  number
  /** Hazards covered ONLY by PPE controls (high/extreme tier). */
  ppeAloneWarnings:      number
  /** Top-5 JHAs ranked by their worst hazard severity desc, then by
   *  oldest-without-review. */
  topByWorstCase:        TopJhaRow[]
}

export interface TopJhaRow {
  id:           string
  job_number:   string
  title:        string
  worst_case:   JhaSeverity | null
  status:       JhaStatus
  hazard_count: number
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers — no DB calls
// ──────────────────────────────────────────────────────────────────────────

export interface JhaRowForMetrics {
  id:                string
  job_number:        string
  title:             string
  status:            JhaStatus
  next_review_date:  string | null
}

export function computeStatusDistribution(rows: JhaRowForMetrics[]): Record<JhaStatus, number> {
  const out: Record<JhaStatus, number> = { draft: 0, in_review: 0, approved: 0, superseded: 0 }
  for (const r of rows) out[r.status]++
  return out
}

// "Active" = anything not superseded.
export function selectActiveJhas(rows: JhaRowForMetrics[]): JhaRowForMetrics[] {
  return rows.filter(r => r.status !== 'superseded')
}

// Approved JHAs past their next_review_date. (Drafts + in_review
// don't count — they aren't "approved and now stale".) `now`
// argument lets tests pin time.
export function countOverdueReview(rows: JhaRowForMetrics[], now: Date = new Date()): number {
  const today = now.toISOString().slice(0, 10)
  let n = 0
  for (const r of rows) {
    if (r.status !== 'approved') continue
    if (!r.next_review_date) continue
    if (r.next_review_date < today) n++
  }
  return n
}

// Count hazards across the active set with a high/extreme severity.
export function countHighOrExtremeHazards(activeJhaIds: Set<string>, hazards: JhaHazard[]): number {
  let n = 0
  for (const h of hazards) {
    if (!activeJhaIds.has(h.jha_id)) continue
    if (h.potential_severity === 'high' || h.potential_severity === 'extreme') n++
  }
  return n
}

export function computeTopByWorstCase(
  activeRows: JhaRowForMetrics[],
  hazards: JhaHazard[],
  limit: number,
): TopJhaRow[] {
  const rank: Record<JhaSeverity, number> = { extreme: 4, high: 3, moderate: 2, low: 1 }
  const byJha = new Map<string, JhaHazard[]>()
  for (const h of hazards) {
    const arr = byJha.get(h.jha_id) ?? []
    arr.push(h)
    byJha.set(h.jha_id, arr)
  }
  return activeRows
    .map(r => {
      const hs = byJha.get(r.id) ?? []
      return {
        id:           r.id,
        job_number:   r.job_number,
        title:        r.title,
        worst_case:   highestPotentialSeverity(hs),
        status:       r.status,
        hazard_count: hs.length,
      }
    })
    .sort((a, b) => {
      const ar = a.worst_case ? rank[a.worst_case] : 0
      const br = b.worst_case ? rank[b.worst_case] : 0
      if (ar !== br) return br - ar
      // Tie-break: more hazards first.
      return b.hazard_count - a.hazard_count
    })
    .slice(0, limit)
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch
// ──────────────────────────────────────────────────────────────────────────

export async function fetchJhaMetrics(): Promise<JhaMetrics | null> {
  const [jhasRes, hazardsRes, ctrlsRes] = await Promise.all([
    supabase.from('jhas').select('id, job_number, title, status, next_review_date'),
    supabase.from('jha_hazards').select('id, jha_id, step_id, hazard_category, description, potential_severity, notes, tenant_id, created_at'),
    supabase.from('jha_hazard_controls').select('id, jha_id, hazard_id, control_id, custom_name, hierarchy_level, notes, tenant_id, created_at'),
  ])

  if (jhasRes.error || hazardsRes.error || ctrlsRes.error) {
    console.warn('[jhaMetrics] fetch failed', jhasRes.error ?? hazardsRes.error ?? ctrlsRes.error)
    return null
  }

  const allJhas  = (jhasRes.data    ?? []) as unknown as JhaRowForMetrics[]
  const hazards  = (hazardsRes.data ?? []) as unknown as JhaHazard[]
  const controls = (ctrlsRes.data   ?? []) as unknown as JhaHazardControl[]

  const active   = selectActiveJhas(allJhas)
  const activeIds = new Set(active.map(r => r.id))
  const activeHazards = hazards.filter(h => activeIds.has(h.jha_id))

  const byStatus = computeStatusDistribution(allJhas)

  return {
    totalActive:          active.length,
    totalAll:             allJhas.length,
    byStatus,
    awaitingApproval:     byStatus.in_review,
    overdueReview:        countOverdueReview(allJhas),
    highOrExtremeHazards: countHighOrExtremeHazards(activeIds, hazards),
    ppeAloneWarnings:     countPpeAloneWarnings(activeHazards, controls),
    topByWorstCase:       computeTopByWorstCase(active, hazards, 5),
  }
}
