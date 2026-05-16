// Vendor / contractor prequalification — pure classifier.
//
// Bucket a prequal row into one of four UI-facing states:
//
//   pending    — invited / in_progress (no decision yet)
//   approved   — approved AND inside its expiry window
//   expiring   — approved AND within 30 days of expiry
//   expired    — approved AND past its expiry, OR DB status === 'expired',
//                OR status === 'rejected' (treated as expired so the
//                contractor can re-apply on the next cycle without UI
//                ambiguity)
//
// The 30-day soft window is a hard-coded default — short enough to
// be actionable, long enough to cover a typical insurance-renewal
// turnaround. Tenants can tighten it in a future setting.

const EXPIRY_WARN_DAYS = 30

export type PrequalStatus =
  | 'invited'
  | 'in_progress'
  | 'approved'
  | 'rejected'
  | 'expired'

export type ClassifiedPrequalStatus =
  | 'pending'
  | 'expiring'
  | 'expired'
  | 'approved'

export interface PrequalRow {
  status:                 PrequalStatus
  approval_expires_at:    string | null
}

/**
 * Bucket a prequalification row for the UI. Pure; deterministic given
 * (row, asOf).
 *
 * Fail-safe rules:
 *   - approved with null expiry         → expired (we don't accept
 *                                          "approved forever")
 *   - approved with unparseable expiry  → expired (defensive: bad data
 *                                          should not look healthy)
 */
export function classifyPrequal(row: PrequalRow, asOf: Date): ClassifiedPrequalStatus {
  if (row.status === 'expired')  return 'expired'
  if (row.status === 'rejected') return 'expired'
  if (row.status === 'invited' || row.status === 'in_progress') return 'pending'

  // status === 'approved' from here on.
  if (!row.approval_expires_at) return 'expired'
  const expiryMs = Date.parse(row.approval_expires_at)
  if (!Number.isFinite(expiryMs)) return 'expired'

  const nowMs = asOf.getTime()
  if (expiryMs < nowMs) return 'expired'

  const warnAfter = expiryMs - EXPIRY_WARN_DAYS * 86_400_000
  if (warnAfter <= nowMs) return 'expiring'

  return 'approved'
}

/**
 * Days until a prequal expires. Returns Infinity for non-approved or
 * unparseable rows so the caller doesn't have to special-case those.
 */
export function daysUntilPrequalExpiry(row: PrequalRow, asOf: Date): number {
  if (row.status !== 'approved' || !row.approval_expires_at) return Infinity
  const expiryMs = Date.parse(row.approval_expires_at)
  if (!Number.isFinite(expiryMs)) return Infinity
  return Math.ceil((expiryMs - asOf.getTime()) / 86_400_000)
}

export const PREQUAL_STATUS_LABEL: Record<ClassifiedPrequalStatus, string> = {
  pending:  'Pending',
  approved: 'Approved',
  expiring: 'Expiring soon',
  expired:  'Expired',
}
