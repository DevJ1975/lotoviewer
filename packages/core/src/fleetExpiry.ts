// Pure aggregator for the fleet credential/document expiry reminder digest.
//
// Lives in @soteria/core so the cron route imports it without pulling
// Supabase/Resend into the test surface. Takes a flat list of dated fleet
// credentials (driver licenses, DOT medical cards, hazmat endorsements) and
// vehicle documents (insurance, registration, annual DOT inspection, …) and
// produces a per-tenant grouped digest the email layer renders.
//
// Same windowing posture as trainingExpiryDigest: nag from EXPIRED_GRACE_DAYS
// in the past through EXPIRING_WINDOW_DAYS in the future; older expirations
// drop out so an unrenewed record doesn't email forever.

export const EXPIRING_WINDOW_DAYS = 30
export const EXPIRED_GRACE_DAYS = 14

export type ExpiryStatus = 'expiring' | 'expired'

// What kind of thing is expiring — drives the label + the link the email
// points at (a vehicle vs. a driver).
export type FleetExpiryKind =
  | 'driver_license'
  | 'driver_medical'
  | 'driver_hazmat'
  | 'vehicle_insurance'
  | 'vehicle_registration'
  | 'vehicle_dot_inspection'
  | 'vehicle_document'

export const FLEET_EXPIRY_KIND_LABELS: Record<FleetExpiryKind, string> = {
  driver_license:         'Driver license',
  driver_medical:         'DOT medical card',
  driver_hazmat:          'Hazmat endorsement',
  vehicle_insurance:      'Insurance',
  vehicle_registration:   'Registration',
  vehicle_dot_inspection: 'Annual DOT inspection',
  vehicle_document:       'Document',
}

export interface RawExpiryRow {
  tenant_id:   string
  kind:        FleetExpiryKind
  /** Display name of the subject — driver name or vehicle unit/identifier. */
  subject:     string
  /** 'driver' | 'vehicle' — which register to deep-link the email at. */
  subject_kind: 'driver' | 'vehicle'
  /** uuid of the driver or vehicle, for the deep link. */
  subject_id:  string
  expires_at:  string | null  // YYYY-MM-DD or null (skipped)
}

export interface DigestRow {
  kind:        FleetExpiryKind
  kind_label:  string
  subject:     string
  subject_kind: 'driver' | 'vehicle'
  subject_id:  string
  expires_on:  string
  status:      ExpiryStatus
  /** Days remaining (expiring) or days overdue (expired), always positive. */
  days:        number
}

export interface TenantDigest {
  tenant_id: string
  rows:      DigestRow[]
}

/**
 * Group expiring/expired fleet records by tenant.
 *   - expires_at null → skipped
 *   - within the next EXPIRING_WINDOW_DAYS → 'expiring'
 *   - past but within EXPIRED_GRACE_DAYS → 'expired'
 *   - older → dropped
 * Sorted within each tenant: expired first (most overdue first), then
 * expiring (soonest first).
 */
export function buildFleetExpiryDigest(
  rows: RawExpiryRow[],
  asOf: Date = new Date(),
): TenantDigest[] {
  const today = ymd(asOf)
  const byTenant = new Map<string, DigestRow[]>()

  for (const r of rows) {
    if (!r.expires_at) continue
    const days = daysBetween(today, r.expires_at)
    let status: ExpiryStatus | null = null
    if (days >= 0 && days <= EXPIRING_WINDOW_DAYS) status = 'expiring'
    else if (days < 0 && Math.abs(days) <= EXPIRED_GRACE_DAYS) status = 'expired'
    if (!status) continue

    const list = byTenant.get(r.tenant_id) ?? []
    list.push({
      kind:         r.kind,
      kind_label:   FLEET_EXPIRY_KIND_LABELS[r.kind],
      subject:      r.subject,
      subject_kind: r.subject_kind,
      subject_id:   r.subject_id,
      expires_on:   r.expires_at,
      status,
      days:         Math.abs(days),
    })
    byTenant.set(r.tenant_id, list)
  }

  const out: TenantDigest[] = []
  for (const [tenant_id, list] of byTenant) {
    list.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'expired' ? -1 : 1
      if (a.status === 'expired') return b.days - a.days   // most overdue first
      return a.days - b.days                               // soonest first
    })
    out.push({ tenant_id, rows: list })
  }
  return out
}

// ── Utilities ──────────────────────────────────────────────────────────
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Days between (target - today). Positive = future, negative = past. */
function daysBetween(today: string, target: string): number {
  const tMs = Date.parse(today + 'T00:00:00Z')
  const xMs = Date.parse(target + 'T00:00:00Z')
  if (Number.isNaN(tMs) || Number.isNaN(xMs)) return 0
  return Math.round((xMs - tMs) / (24 * 60 * 60 * 1000))
}
