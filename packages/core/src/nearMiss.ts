// Near-Miss Reporting — types + small pure helpers shared across
// web and mobile. Mirrors packages/core/src/risk.ts in spirit but
// the domain is much smaller (no scoring matrix, no controls).
//
// Authoritative shapes live in the DB (migration 042); the types
// here are the read-side contract used by API routes and UI code.
// If the DB schema changes, update this file in the same commit so
// readers stay honest.

// ──────────────────────────────────────────────────────────────────────────
// Enums (text-CHECK columns in migration 042)
// ──────────────────────────────────────────────────────────────────────────

// Hazard taxonomy is shared with the risk module — a near-miss
// rolls up into the same hazard-category dashboards by design.
export const NEAR_MISS_HAZARD_CATEGORIES = [
  'physical', 'chemical', 'biological', 'mechanical', 'electrical',
  'ergonomic', 'psychosocial', 'environmental', 'radiological',
] as const
export type NearMissHazardCategory = typeof NEAR_MISS_HAZARD_CATEGORIES[number]

// Same 4-band scheme as the risk module so the two surfaces share
// visual language. See risk.ts colorFor() for the band → color map
// (intentionally not duplicated — read-side rendering imports from
// risk.ts).
export const NEAR_MISS_SEVERITY_BANDS = ['low', 'moderate', 'high', 'extreme'] as const
export type NearMissSeverity = typeof NEAR_MISS_SEVERITY_BANDS[number]

export const NEAR_MISS_STATUSES = [
  'new', 'triaged', 'investigating', 'closed', 'escalated_to_risk',
] as const
export type NearMissStatus = typeof NEAR_MISS_STATUSES[number]

// ──────────────────────────────────────────────────────────────────────────
// Row shape
// ──────────────────────────────────────────────────────────────────────────

export interface NearMissRow {
  id:                      string
  tenant_id:               string
  report_number:           string                // NM-YYYY-NNNN, set by trigger
  occurred_at:             string                // ISO timestamp
  reported_at:             string
  reported_by:             string                // auth user id
  location:                string | null
  description:             string
  immediate_action_taken:  string | null
  hazard_category:         NearMissHazardCategory
  severity_potential:      NearMissSeverity
  status:                  NearMissStatus
  assigned_to:             string | null
  linked_risk_id:          string | null
  resolved_at:             string | null
  resolution_notes:        string | null
  created_at:              string
  updated_at:              string
  updated_by:              string | null
}

// Shape used by the create form / POST /api/near-miss. The DB sets
// report_number, status (defaults 'new'), reported_at, created_at,
// updated_at, and ids — so callers just provide the human-supplied
// fields. tenant_id is resolved server-side from the active-tenant
// gate; reported_by is derived from the JWT.
export interface NearMissCreateInput {
  occurred_at:             string
  location?:               string | null
  description:             string
  immediate_action_taken?: string | null
  hazard_category:         NearMissHazardCategory
  severity_potential:      NearMissSeverity
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// Sort key for triage views — highest-severity, oldest-first. Lower
// numbers sort earlier.
const SEVERITY_RANK: Record<NearMissSeverity, number> = {
  extreme: 0, high: 1, moderate: 2, low: 3,
}

export function compareForTriage(a: NearMissRow, b: NearMissRow): number {
  const sev = SEVERITY_RANK[a.severity_potential] - SEVERITY_RANK[b.severity_potential]
  if (sev !== 0) return sev
  // Same severity → oldest report bubbles up (longest-waiting).
  return a.reported_at.localeCompare(b.reported_at)
}

// Statuses the user-facing list defaults to hiding. 'closed' near-misses
// are still queryable via an explicit filter; the default view shows
// active work only.
export const ACTIVE_NEAR_MISS_STATUSES: ReadonlyArray<NearMissStatus> = [
  'new', 'triaged', 'investigating',
]

export function isActive(row: Pick<NearMissRow, 'status'>): boolean {
  return ACTIVE_NEAR_MISS_STATUSES.includes(row.status)
}

// Days between reported_at and now (or resolved_at if closed). Used
// by KPI tiles + the "longest open" sort. Returns whole days,
// floor-rounded; never negative.
export function ageInDays(row: Pick<NearMissRow, 'reported_at' | 'resolved_at'>, now: Date = new Date()): number {
  const start = new Date(row.reported_at).getTime()
  const end   = row.resolved_at ? new Date(row.resolved_at).getTime() : now.getTime()
  const diff  = Math.max(0, end - start)
  return Math.floor(diff / 86_400_000)
}

// Validate the create input. Returns null if valid, error string
// otherwise. The DB CHECK constraints are the authority — this is
// just early feedback for the form.
export function validateCreateInput(input: Partial<NearMissCreateInput>): string | null {
  if (!input.description || !input.description.trim()) return 'Description is required'
  if (!input.occurred_at) return 'When did it occur? is required'
  if (!input.hazard_category)
    return 'Hazard category is required'
  if (!NEAR_MISS_HAZARD_CATEGORIES.includes(input.hazard_category as NearMissHazardCategory))
    return `Invalid hazard category: ${input.hazard_category}`
  if (!input.severity_potential)
    return 'Severity potential is required'
  if (!NEAR_MISS_SEVERITY_BANDS.includes(input.severity_potential as NearMissSeverity))
    return `Invalid severity: ${input.severity_potential}`
  // Reject timestamps from the future (clock skew tolerance: 5 min).
  const occ = Date.parse(input.occurred_at)
  if (Number.isNaN(occ)) return 'occurred_at is not a valid timestamp'
  if (occ > Date.now() + 5 * 60_000) return 'occurred_at cannot be in the future'
  return null
}
