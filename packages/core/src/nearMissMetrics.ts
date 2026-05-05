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

export async function fetchNearMissMetrics(): Promise<NearMissMetrics | null> {
  const { data, error } = await supabase
    .from('near_misses')
    .select('id, report_number, description, status, severity_potential, reported_at, resolved_at')

  if (error) {
    console.warn('[nearMissMetrics] fetch failed', error)
    return null
  }

  const rows = (data ?? []) as unknown as NearMissRowForMetrics[]
  const active = selectActive(rows)

  return {
    totalActive:    active.length,
    totalAll:       rows.length,
    bySeverity:     computeSeverityDistribution(active),
    newLast30Days:  countReportedSince(rows, 30),
    agingActive:    countAging(rows, 30),
    topUnresolved:  computeTopUnresolved(rows, 5),
  }
}
