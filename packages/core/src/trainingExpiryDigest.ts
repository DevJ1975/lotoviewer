// Pure aggregator for the daily training-expiry reminder digest.
//
// Lives in @soteria/core so the cron route can import it without
// pulling Supabase or Resend into the test surface. Takes a flat
// row list (one row per training record with tenant_id) and
// produces a per-tenant grouped output the email layer can consume.

import { TRAINING_ROLE_LABELS } from './trainingRecords'
import type { TrainingRole } from './types'

// How many days BEFORE expiry an entry counts as "expiring soon".
// Matches the LOTO checkout dialog's expiring-vs-current threshold.
export const EXPIRING_WINDOW_DAYS = 30

// How many days AFTER expiry to keep nagging. Past this window the
// row drops out of the digest so an unrenewed cert doesn't generate
// emails forever — at that point the worker's been blocked from
// every gated workflow already.
export const EXPIRED_GRACE_DAYS = 7

export type ExpiryStatus = 'expiring' | 'expired'

export interface DigestRow {
  worker_name:     string
  role:            TrainingRole
  role_label:      string
  expires_on:      string                     // YYYY-MM-DD
  status:          ExpiryStatus
  /** days remaining (positive) for 'expiring', or days overdue (positive) for 'expired'. */
  days:            number
}

export interface TenantDigest {
  tenant_id:    string
  rows:         DigestRow[]
}

export interface RawTrainingRow {
  tenant_id:    string
  worker_name:  string
  role:         TrainingRole
  expires_at:   string | null  // YYYY-MM-DD or null (no expiry)
  completed_at: string         // YYYY-MM-DD
}

/**
 * Group expiring/expired training records by tenant. Rules:
 *   - expires_at IS NULL → never included (no expiry on file)
 *   - expires_at within the next EXPIRING_WINDOW_DAYS → 'expiring'
 *   - expires_at in the past, within EXPIRED_GRACE_DAYS → 'expired'
 *   - older expirations → dropped (silenced)
 *   - within a (worker, role) group, only the FRESHEST expiry counts
 *     — a recent renewal supersedes an older expired record
 *
 * Output rows are sorted within each tenant: expired first (worst
 * first), then expiring (soonest first), so the email lists the most
 * urgent entries at the top.
 */
export function buildExpiryDigest(
  rows: RawTrainingRow[],
  asOf: Date = new Date(),
): TenantDigest[] {
  const today = ymd(asOf)

  // Bucket by (tenant, worker, role) and keep the freshest record per bucket.
  // Freshness defined by the latest completed_at — same posture as the
  // training-validation gates.
  const fresh = new Map<string, RawTrainingRow>()
  for (const r of rows) {
    const k = `${r.tenant_id}|${r.worker_name.trim().toLowerCase()}|${r.role}`
    const existing = fresh.get(k)
    if (!existing || r.completed_at > existing.completed_at) {
      fresh.set(k, r)
    }
  }

  // Walk the freshest records and classify each.
  const byTenant = new Map<string, DigestRow[]>()
  for (const r of fresh.values()) {
    if (!r.expires_at) continue
    const days = daysBetween(today, r.expires_at)
    let status: ExpiryStatus | null = null
    if (days >= 0 && days <= EXPIRING_WINDOW_DAYS) {
      status = 'expiring'
    } else if (days < 0 && Math.abs(days) <= EXPIRED_GRACE_DAYS) {
      status = 'expired'
    }
    if (!status) continue

    const list = byTenant.get(r.tenant_id) ?? []
    list.push({
      worker_name: r.worker_name,
      role:        r.role,
      role_label:  TRAINING_ROLE_LABELS[r.role],
      expires_on:  r.expires_at,
      status,
      days:        Math.abs(days),
    })
    byTenant.set(r.tenant_id, list)
  }

  // Sort within each tenant — expired first (most overdue first), then
  // expiring (soonest first).
  const out: TenantDigest[] = []
  for (const [tenant_id, rows] of byTenant) {
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'expired' ? -1 : 1
      if (a.status === 'expired') return b.days - a.days       // bigger overdue first
      return a.days - b.days                                   // smaller remaining first
    })
    out.push({ tenant_id, rows })
  }
  return out
}

// ── Utilities ──────────────────────────────────────────────────────────
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Returns days between (target - today). Positive = future, negative = past. */
function daysBetween(today: string, target: string): number {
  const tMs = Date.parse(today  + 'T00:00:00Z')
  const xMs = Date.parse(target + 'T00:00:00Z')
  if (Number.isNaN(tMs) || Number.isNaN(xMs)) return 0
  return Math.round((xMs - tMs) / (24 * 60 * 60 * 1000))
}
