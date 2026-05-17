// §147(f)(2) host/contractor compliance — pure helpers.
//
// The digest helper groups contractor companies by insurance status so
// the renewal-reminder email can show "5 contractors have insurance
// expiring this month; 2 already expired." Mirrors the
// trainingExpiryDigest pattern from migration 017 — same buckets,
// same grace window.

export const INSURANCE_EXPIRING_WINDOW_DAYS = 30
export const INSURANCE_EXPIRED_GRACE_DAYS  = 7

export type InsuranceStatus = 'current' | 'expiring' | 'expired' | 'missing'

export interface ContractorCompany {
  id: string
  tenant_id: string
  name: string
  contact_email: string | null
  contact_phone: string | null
  insurance_expires_at: string | null  // YYYY-MM-DD
  host_procedures_acknowledged_at: string | null
  host_acknowledged_by_user_id: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface ContractorDigestRow {
  contractor_id: string
  name: string
  status: InsuranceStatus
  expires_on: string | null
  /** Positive number of days until expiry (status='expiring') OR overdue (status='expired'). */
  days: number | null
}

/**
 * Classify a single contractor's insurance status.
 *
 *   - null expiry         → 'missing'  (incomplete records)
 *   - >30 days out         → 'current'
 *   - within 30 days       → 'expiring'
 *   - past expiry          → 'expired'  (still surfaced for up to 7 days,
 *                                        then drops out of the digest)
 */
export function classifyInsurance(
  insuranceExpiresAt: string | null,
  asOf: Date,
): { status: InsuranceStatus; days: number | null } {
  if (!insuranceExpiresAt) return { status: 'missing', days: null }
  const expiryMs = Date.parse(insuranceExpiresAt + 'T00:00:00Z')
  if (Number.isNaN(expiryMs)) return { status: 'missing', days: null }
  const todayMs = Date.parse(asOf.toISOString().slice(0, 10) + 'T00:00:00Z')
  const dayMs   = 24 * 60 * 60 * 1000
  const diff    = Math.floor((expiryMs - todayMs) / dayMs)
  if (diff < 0)
    return { status: 'expired',  days: Math.abs(diff) }
  if (diff <= INSURANCE_EXPIRING_WINDOW_DAYS)
    return { status: 'expiring', days: diff }
  return { status: 'current', days: diff }
}

/**
 * Build the renewal-reminder digest from a flat contractor list.
 * Returns one row per contractor that is expiring or recently
 * expired. 'current' and 'missing' are excluded — current rows are
 * reassurance the digest doesn't need to call out, and 'missing'
 * is an admin-data issue that surfaces in the /admin/people/contractors UI.
 */
export function buildContractorInsuranceDigest(
  companies: ContractorCompany[],
  asOf: Date = new Date(),
): ContractorDigestRow[] {
  const rows: ContractorDigestRow[] = []
  for (const c of companies) {
    if (!c.active) continue
    const { status, days } = classifyInsurance(c.insurance_expires_at, asOf)
    if (status === 'current' || status === 'missing') continue
    if (status === 'expired' && (days ?? 0) > INSURANCE_EXPIRED_GRACE_DAYS) continue
    rows.push({
      contractor_id: c.id,
      name:          c.name,
      status,
      expires_on:    c.insurance_expires_at,
      days,
    })
  }
  // Expired first (worst-first), then expiring soonest-first.
  rows.sort((a, b) => {
    if (a.status === b.status) {
      if (a.status === 'expired') return (b.days ?? 0) - (a.days ?? 0)
      return (a.days ?? 0) - (b.days ?? 0)
    }
    return a.status === 'expired' ? -1 : 1
  })
  return rows
}
