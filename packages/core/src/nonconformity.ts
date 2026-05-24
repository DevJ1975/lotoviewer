// Shared logic for the source-agnostic nonconformity & CAPA register
// (ISO 14001 §10.2 / §9.2; migration 203). The separation-of-duty rule —
// the verifier must differ from the completer — is enforced in the DB; it
// is mirrored here so the UI can disable "verify" for the completer
// instead of round-tripping to a failed insert.

export type NonconformitySourceType =
  | 'internal_audit'
  | 'management_review'
  | 'compliance'
  | 'inspection'
  | 'environmental_aspect'
  | 'incident'
  | 'customer'
  | 'other'

export type NonconformityClassification = 'observation' | 'minor' | 'major'
export type NonconformityStatus = 'open' | 'in_progress' | 'closed' | 'cancelled'

export type ActionType = 'correction' | 'corrective' | 'preventive'
export type ActionStatus = 'open' | 'in_progress' | 'completed' | 'verified' | 'cancelled'

export const NONCONFORMITY_SOURCE_TYPES: readonly { value: NonconformitySourceType; label: string }[] = [
  { value: 'internal_audit',       label: 'Internal audit' },
  { value: 'management_review',    label: 'Management review' },
  { value: 'compliance',           label: 'Compliance obligation' },
  { value: 'inspection',           label: 'Inspection' },
  { value: 'environmental_aspect', label: 'Environmental aspect' },
  { value: 'incident',             label: 'Incident' },
  { value: 'customer',             label: 'Customer / external' },
  { value: 'other',                label: 'Other' },
]

export const NONCONFORMITY_CLASSIFICATIONS: readonly { value: NonconformityClassification; label: string }[] = [
  { value: 'observation', label: 'Observation' },
  { value: 'minor',       label: 'Minor' },
  { value: 'major',       label: 'Major' },
]

export const NONCONFORMITY_STATUSES: readonly { value: NonconformityStatus; label: string }[] = [
  { value: 'open',        label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed',      label: 'Closed' },
  { value: 'cancelled',   label: 'Cancelled' },
]

export const ACTION_TYPES: readonly { value: ActionType; label: string }[] = [
  { value: 'correction', label: 'Correction (immediate fix)' },
  { value: 'corrective', label: 'Corrective (addresses root cause)' },
  { value: 'preventive', label: 'Preventive' },
]

/** A CAPA can be verified only once it's completed, and never by the same
 * person who completed it (separation of duty — ISO §10.2). Mirrors the
 * DB trigger so the UI can pre-empt the failure. */
export function canVerifyAction(
  action: { status: ActionStatus; completed_by_user_id: string | null },
  currentUserId: string | null,
): boolean {
  if (action.status !== 'completed') return false
  if (!action.completed_by_user_id || !currentUserId) return false
  return action.completed_by_user_id !== currentUserId
}

/** Tally a finding's actions for the register's per-row rollup. "Outstanding"
 * is anything not yet verified or cancelled. */
export function summarizeActions(
  actions: readonly { status: ActionStatus }[],
): { total: number; outstanding: number; verified: number } {
  let outstanding = 0
  let verified = 0
  for (const a of actions) {
    if (a.status === 'verified') verified++
    else if (a.status !== 'cancelled') outstanding++
  }
  return { total: actions.length, outstanding, verified }
}
