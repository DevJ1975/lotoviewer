// Pure classifier for incident_capas rows.
//
// The DB stores the lifecycle (open / in_progress / completed /
// verified / cancelled). The UI also wants a derived "awaiting
// verification" + "overdue" view that the DB doesn't carry directly
// — those are functions of (status, due_at, asOf). This module is
// the single source of truth for that derivation so the incident
// detail page, the scorecard widget, and any future cron all agree.

export type CapaStatus =
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'cancelled'

export type CapaHierarchyLevel =
  | 'eliminate'
  | 'substitute'
  | 'engineering'
  | 'administrative'
  | 'ppe'

export interface CapaRow {
  id:                    string
  status:                CapaStatus
  due_at:                string | null
  completed_at:          string | null
  completed_by_user_id:  string | null
  verified_effective_at: string | null
  verified_by_user_id:   string | null
  // Editable payload fields. Optional on the type so the existing
  // classifier-only tests can keep using a small shape without
  // exposing every field on the row.
  description?:          string
  hierarchy_level?:      CapaHierarchyLevel
  assigned_to_user_id?:  string | null
  verification_notes?:   string | null
}

export type ClassifiedCapaStatus =
  | 'open'
  | 'overdue'
  | 'awaiting_verification'
  | 'verified'
  | 'cancelled'

/**
 * Bucket a CAPA into one of five UI-facing states.
 *
 * Rules:
 *   - verified / cancelled — pass through unchanged.
 *   - completed but not yet verified — awaiting_verification (a
 *     separate verifier still needs to confirm effectiveness).
 *   - open / in_progress with due_at in the past — overdue.
 *   - everything else — open (covers fresh actions, in-progress
 *     actions inside their window, and actions with no due date).
 */
export function classifyCapa(capa: CapaRow, asOf: Date): ClassifiedCapaStatus {
  if (capa.status === 'verified')  return 'verified'
  if (capa.status === 'cancelled') return 'cancelled'
  if (capa.status === 'completed') return 'awaiting_verification'

  // Open or in_progress. Overdue iff there's a parseable due_at in
  // the past. Unparseable due dates are treated as "no due", which
  // matches what the user sees in the UI.
  if (capa.due_at) {
    const dueMs = Date.parse(capa.due_at)
    if (Number.isFinite(dueMs) && dueMs < asOf.getTime()) return 'overdue'
  }
  return 'open'
}

export interface CapaSummary {
  total:                 number
  open:                  number
  overdue:               number
  awaiting_verification: number
  verified:              number
  cancelled:             number
}

/**
 * Reduce a list of CAPAs into per-state counts. Used by the scorecard
 * widget and any future "CAPAs awaiting verification" digest.
 */
export function summarizeCapas(capas: CapaRow[], asOf: Date): CapaSummary {
  const summary: CapaSummary = {
    total:                 0,
    open:                  0,
    overdue:               0,
    awaiting_verification: 0,
    verified:              0,
    cancelled:             0,
  }
  for (const c of capas) {
    summary.total++
    summary[classifyCapa(c, asOf)]++
  }
  return summary
}

/**
 * The verification-of-effectiveness gate: the user marking a CAPA
 * verified must be DIFFERENT from the user who marked it completed.
 * Returns true when the gate allows the action, false when it must
 * be blocked. The database enforces the same rule (trigger), but
 * surfacing it client-side lets the UI hide the button and show a
 * sensible reason without a roundtrip.
 *
 * Defensive: returns false on missing inputs — without a verifier or
 * a completer the gate has no signal, so the safest answer is "no".
 */
export function canVerify(capa: CapaRow, verifierUserId: string | null | undefined): boolean {
  if (!verifierUserId) return false
  if (!capa.completed_at) return false
  if (capa.status !== 'completed') return false
  return capa.completed_by_user_id !== verifierUserId
}

export const CAPA_HIERARCHY_LEVELS: readonly CapaHierarchyLevel[] = [
  'eliminate', 'substitute', 'engineering', 'administrative', 'ppe',
]

export const CAPA_HIERARCHY_LABEL: Record<CapaHierarchyLevel, string> = {
  eliminate:      'Eliminate',
  substitute:     'Substitute',
  engineering:    'Engineering control',
  administrative: 'Administrative control',
  ppe:            'PPE',
}
