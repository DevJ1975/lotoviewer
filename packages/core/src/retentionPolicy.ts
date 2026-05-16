// Retention-policy classifier — pure helpers for "is this record
// still in its retention window?" and "when does it become eligible
// for purge?"
//
// Architecture: the database stores intent (per-tenant retention
// windows in tenant_retention_policies + open legal holds in
// legal_holds). The actual deletion lives in a future cron. This
// module is the classifier the cron + UI both consume so there's a
// single authoritative answer.
//
// Legal-hold doctrine: a record with an active legal hold ALWAYS
// retains. The hold trumps every retention window. Releasing the
// hold (released_at set) restores the normal classification.

export type RecordType =
  | 'incident'
  | 'permit'
  | 'training'
  | 'loto_artifact'

export interface RetentionPolicy {
  /** OSHA 1904.33 — 5 years (1825 days) by default. */
  incident_retention_days:      number
  /** Permits — 3 years (1095 days) by default. */
  permit_retention_days:        number
  /** Training records — 3 years (1095 days) by default. */
  training_retention_days:      number
  /** LOTO procedure/placard binders — 7 YEARS by default. Stored in
   * years upstream because audit cycles think in years; converted
   * to days at the comparison boundary. */
  loto_artifact_retention_years: number
}

export interface RetentionRecord {
  /** The kind of record being classified. */
  type:           RecordType
  /** Anchor timestamp — usually the record's `created_at`. ISO string. */
  created_at:     string
  /** ID of the open legal hold protecting this row, if any. NULL means
   * no hold. The hold-table is authoritative; this column is just a
   * denormalised pointer the UI can read fast. */
  legal_hold_id?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function windowDaysFor(record: RetentionRecord, policy: RetentionPolicy): number {
  switch (record.type) {
    case 'incident':      return policy.incident_retention_days
    case 'permit':        return policy.permit_retention_days
    case 'training':      return policy.training_retention_days
    case 'loto_artifact': return policy.loto_artifact_retention_years * 365
  }
}

/**
 * True when the record must be kept. A record under legal hold is
 * always retained, regardless of its age. Without a hold, the record
 * retains until `created_at + window` is past asOf.
 *
 * Returns `true` (retain) on any unparseable input — fail-safe: never
 * recommend purge because of a parsing bug.
 */
export function shouldRetain(
  record: RetentionRecord,
  policy: RetentionPolicy,
  asOf:   Date,
): boolean {
  if (record.legal_hold_id) return true
  const ageMs = asOf.getTime() - Date.parse(record.created_at)
  if (!Number.isFinite(ageMs)) return true
  const windowMs = windowDaysFor(record, policy) * DAY_MS
  return ageMs < windowMs
}

/**
 * Days remaining until the record becomes eligible for purge. Returns
 * positive when retain is still required, 0 on the eligibility
 * boundary, negative when the record has been past its window for
 * |result| days.
 *
 * Legal hold → returns Infinity so the UI can show "Held — purge
 * blocked" without the helper having to expose a second concept.
 *
 * Unparseable created_at → returns Infinity, matching the fail-safe
 * shouldRetain default.
 */
export function daysUntilEligibleForPurge(
  record: RetentionRecord,
  policy: RetentionPolicy,
  asOf:   Date,
): number {
  if (record.legal_hold_id) return Infinity
  const created = Date.parse(record.created_at)
  if (!Number.isFinite(created)) return Infinity
  const eligibleMs = created + windowDaysFor(record, policy) * DAY_MS
  // Math.ceil — a record that becomes eligible mid-day is still on
  // its current day until midnight; rounding up matches the cron's
  // day-bucket semantics (it runs once a day).
  return Math.ceil((eligibleMs - asOf.getTime()) / DAY_MS)
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = Object.freeze({
  incident_retention_days:      1825,
  permit_retention_days:        1095,
  training_retention_days:      1095,
  loto_artifact_retention_years: 7,
})
