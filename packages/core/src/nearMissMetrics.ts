// Near-Miss intelligence aggregator. Reads the active tenant's
// near_misses (RLS-scoped via the registered Supabase client) and
// computes leading-indicator counts for the home dashboard.
//
// Pure helpers are exported alongside fetchNearMissMetrics() so the
// math is testable without hitting a database.

import { supabase } from './supabaseClient'
import {
  ACTIVE_NEAR_MISS_STATUSES,
  type NearMissSeverity,
  type NearMissStatus,
} from './nearMiss'

// ──────────────────────────────────────────────────────────────────────────
// Result shapes
// ──────────────────────────────────────────────────────────────────────────

export interface NearMissMetrics {
  /** Reports in active statuses (new / triaged / investigating). */
  totalActive:        number
  /** Total reports (including closed + escalated) — denominator. */
  totalAll:           number
  /** Distribution of active reports by severity_potential band. */
  bySeverity:         Record<NearMissSeverity, number>
  /** Reports filed in the last 30 days (active or not). Trend signal. */
  newLast30Days:      number
  /** Active reports older than 30 days — the "stuck in triage" cohort. */
  agingActive:        number
  /** Top 5 unresolved reports ranked by severity desc → reported_at asc. */
  topUnresolved:      TopNearMissRow[]
}

export interface TopNearMissRow {
  id:                 string
  report_number:      string
  description:        string
  severity_potential: NearMissSeverity
  status:             NearMissStatus
  reported_at:        string
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers — no DB calls
// ──────────────────────────────────────────────────────────────────────────

export interface NearMissRowForMetrics {
  id:                 string
  report_number:      string
  description:        string
  status:             NearMissStatus
  severity_potential: NearMissSeverity
  reported_at:        string
  resolved_at:        string | null
}

const SEVERITY_RANK: Record<NearMissSeverity, number> = {
  extreme: 0, high: 1, moderate: 2, low: 3,
}

export function computeSeverityDistribution(rows: NearMissRowForMetrics[]): Record<NearMissSeverity, number> {
  const out: Record<NearMissSeverity, number> = { low: 0, moderate: 0, high: 0, extreme: 0 }
  for (const r of rows) out[r.severity_potential]++
  return out
}

// "Active" mirrors ACTIVE_NEAR_MISS_STATUSES from nearMiss.ts —
// new / triaged / investigating. Closed + escalated drop out of
// the active cohort.
export function selectActive(rows: NearMissRowForMetrics[]): NearMissRowForMetrics[] {
  return rows.filter(r => (ACTIVE_NEAR_MISS_STATUSES as readonly string[]).includes(r.status))
}

// Reports filed in the last N days, regardless of current status.
// Trend signal — a spike in filings is a leading indicator on its
// own, even if every one of them gets closed quickly.
export function countReportedSince(
  rows: NearMissRowForMetrics[],
  windowDays: number,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - windowDays * 86_400_000
  let n = 0
  for (const r of rows) {
    if (Date.parse(r.reported_at) >= cutoff) n++
  }
  return n
}

// Active reports older than `windowDays` — the "stuck in triage"
// cohort that should be aging out of new/triaged into investigating
// or closed.
export function countAging(
  rows: NearMissRowForMetrics[],
  windowDays: number,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - windowDays * 86_400_000
  let n = 0
  for (const r of selectActive(rows)) {
    if (Date.parse(r.reported_at) < cutoff) n++
  }
  return n
}

export function computeTopUnresolved(
  rows: NearMissRowForMetrics[],
  n: number,
): TopNearMissRow[] {
  return selectActive(rows)
    .slice()
    .sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity_potential] - SEVERITY_RANK[b.severity_potential]
      if (sev !== 0) return sev
      return a.reported_at.localeCompare(b.reported_at)
    })
    .slice(0, n)
    .map(r => ({
      id:                 r.id,
      report_number:      r.report_number,
      description:        r.description,
      severity_potential: r.severity_potential,
      status:             r.status,
      reported_at:        r.reported_at,
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// Fetch
// ──────────────────────────────────────────────────────────────────────────

// Both 30-day tiles ("New (30 d)" and ">30 d open") pivot on the same
// boundary, so they share one constant.
const WINDOW_DAYS = 30

// Backstop, not a business rule: a tenant with this many reports still
// OPEN has a triage problem, not a reporting one. Hitting it warns
// rather than silently shrinking the derived tiles.
const MAX_ACTIVE_ROWS = 5_000

export async function fetchNearMissMetrics(): Promise<NearMissMetrics | null> {
  const nowMs = Date.now()
  const windowStartIso = new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString()

  // Every tile except the two totals is derived from the OPEN cohort, so
  // that's the only thing worth shipping to the browser — the totals come
  // back as counts, which keeps the payload proportional to the backlog
  // instead of to the tenant's entire reporting history.
  const [activeRes, totalRes, recentRes] = await Promise.all([
    supabase
      .from('near_misses')
      .select(
        'id, report_number, description, status, severity_potential, reported_at, resolved_at',
        { count: 'exact' },
      )
      .in('status', ACTIVE_NEAR_MISS_STATUSES as readonly string[])
      // Oldest first so that if the cap ever bites, the rows kept are the
      // ones the aging + top-unresolved tiles care about.
      .order('reported_at', { ascending: true })
      .limit(MAX_ACTIVE_ROWS),
    supabase
      .from('near_misses')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('near_misses')
      .select('id', { count: 'exact', head: true })
      .gte('reported_at', windowStartIso),
  ])

  const error = activeRes.error ?? totalRes.error ?? recentRes.error
  if (error) {
    console.warn('[nearMissMetrics] fetch failed', error)
    return null
  }

  const active = (activeRes.data ?? []) as unknown as NearMissRowForMetrics[]
  if (active.length >= MAX_ACTIVE_ROWS) {
    console.warn(
      `[nearMissMetrics] open-report cap (${MAX_ACTIVE_ROWS}) reached — severity, aging and top-unresolved cover the oldest ${MAX_ACTIVE_ROWS} open reports only`,
    )
  }

  return {
    totalActive:    activeRes.count ?? active.length,
    totalAll:       totalRes.count ?? 0,
    bySeverity:     computeSeverityDistribution(active),
    newLast30Days:  recentRes.count ?? 0,
    agingActive:    countAging(active, WINDOW_DAYS, new Date(nowMs)),
    topUnresolved:  computeTopUnresolved(active, 5),
  }
}
