// Incident corrective + preventive actions (CAPA) — types + helpers.
//
// One incident can have many actions; each carries an owner, due
// date, and status lifecycle. The hierarchy_of_controls column lets
// the scorecard report on a tenant's CAPA mix (a healthy program
// skews to elimination/engineering, not PPE).

export const INCIDENT_ACTION_TYPES = [
  'corrective', 'preventive', 'interim',
] as const
export type IncidentActionType = typeof INCIDENT_ACTION_TYPES[number]

export const HIERARCHY_OF_CONTROLS = [
  'elimination', 'substitution', 'engineering', 'administrative', 'ppe',
] as const
export type HierarchyOfControls = typeof HIERARCHY_OF_CONTROLS[number]

// Strength ranking used by the scorecard. Lower = stronger control
// (elimination is the most effective; PPE is the weakest). Source:
// NIOSH hierarchy of controls.
export const HIERARCHY_RANK: Record<HierarchyOfControls, number> = {
  elimination:    1,
  substitution:   2,
  engineering:    3,
  administrative: 4,
  ppe:            5,
}

export const HIERARCHY_LABEL: Record<HierarchyOfControls, string> = {
  elimination:    'Elimination',
  substitution:   'Substitution',
  engineering:    'Engineering control',
  administrative: 'Administrative control',
  ppe:            'PPE',
}

export const ACTION_TYPE_LABEL: Record<IncidentActionType, string> = {
  corrective: 'Corrective',
  preventive: 'Preventive',
  interim:    'Interim',
}

export const INCIDENT_ACTION_STATUSES = [
  'open', 'in_progress', 'blocked', 'complete', 'verified', 'cancelled',
] as const
export type IncidentActionStatus = typeof INCIDENT_ACTION_STATUSES[number]

export const ACTION_STATUS_LABEL: Record<IncidentActionStatus, string> = {
  open:        'Open',
  in_progress: 'In progress',
  blocked:     'Blocked',
  complete:    'Complete',
  verified:    'Verified',
  cancelled:   'Cancelled',
}

// Statuses that count an action as "still on the books" — used by
// the home OpenActionsPanel and the on-time-closure metric.
export const OPEN_ACTION_STATUSES: ReadonlyArray<IncidentActionStatus> = [
  'open', 'in_progress', 'blocked',
]

export interface IncidentActionRow {
  id:                      string
  tenant_id:               string
  incident_id:             string
  action_type:             IncidentActionType
  hierarchy_of_controls:   HierarchyOfControls | null
  description:             string
  owner_user_id:           string | null
  due_at:                  string | null
  status:                  IncidentActionStatus
  completed_at:            string | null
  verified_at:             string | null
  verified_by:             string | null
  verification_evidence:   string | null
  source_rca_node_id:      string | null
  cancel_reason:           string | null
  created_at:              string
  updated_at:              string
  created_by:              string | null
  updated_by:              string | null
}

export interface IncidentActionCreateInput {
  action_type:            IncidentActionType
  description:            string
  hierarchy_of_controls?: HierarchyOfControls | null
  owner_user_id?:         string | null
  due_at?:                string | null
  source_rca_node_id?:    string | null
}

export interface IncidentActionPatchInput {
  description?:           string
  hierarchy_of_controls?: HierarchyOfControls | null
  owner_user_id?:         string | null
  due_at?:                string | null
  status?:                IncidentActionStatus
  verification_evidence?: string | null
  cancel_reason?:         string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Validators
// ──────────────────────────────────────────────────────────────────────────

export function validateActionCreate(input: Partial<IncidentActionCreateInput>): string | null {
  if (!input.action_type
      || !(INCIDENT_ACTION_TYPES as readonly string[]).includes(input.action_type))
    return `Invalid action_type: ${input.action_type ?? '(missing)'}`
  if (!input.description || !input.description.trim())
    return 'description is required'
  if (input.hierarchy_of_controls
      && !(HIERARCHY_OF_CONTROLS as readonly string[]).includes(input.hierarchy_of_controls))
    return `Invalid hierarchy_of_controls: ${input.hierarchy_of_controls}`
  if (input.due_at && Number.isNaN(Date.parse(input.due_at)))
    return 'due_at is not a valid timestamp'
  return null
}

// Status transition rules — keeps the lifecycle linear without
// blocking legitimate moves like "blocked → in_progress" or
// "complete → in_progress" (a verifier rejects the work).
const ALLOWED_TRANSITIONS: Record<IncidentActionStatus, ReadonlyArray<IncidentActionStatus>> = {
  open:        ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['open', 'blocked', 'complete', 'cancelled'],
  blocked:     ['open', 'in_progress', 'cancelled'],
  complete:    ['in_progress', 'verified', 'cancelled'],
  // Verified is the terminal "approved" state — re-opening an
  // already-verified action is unusual but legitimate when a
  // re-audit fails. Allow transition back to in_progress.
  verified:    ['in_progress'],
  cancelled:   ['open'],
}

export function canTransition(from: IncidentActionStatus, to: IncidentActionStatus): boolean {
  if (from === to) return true                         // no-op
  return ALLOWED_TRANSITIONS[from].includes(to)
}

// ──────────────────────────────────────────────────────────────────────────
// Closed-on-time helpers (for the scorecard)
// ──────────────────────────────────────────────────────────────────────────

// Returns true when the action was closed (status crossed into
// complete or verified) on or before its due_at. Actions without a
// due_at are treated as on-time when closed (no deadline to miss).
export function isClosedOnTime(action: Pick<IncidentActionRow, 'status' | 'completed_at' | 'due_at'>): boolean {
  if (action.status !== 'complete' && action.status !== 'verified') return false
  if (!action.completed_at) return false
  if (!action.due_at) return true
  return new Date(action.completed_at).getTime() <= new Date(action.due_at).getTime()
}

// Days until due — negative when overdue. Returns null when there's
// no deadline. Floor-rounded.
export function daysUntilDue(
  action: Pick<IncidentActionRow, 'due_at'>,
  now: Date = new Date(),
): number | null {
  if (!action.due_at) return null
  const diff = new Date(action.due_at).getTime() - now.getTime()
  return Math.floor(diff / 86_400_000)
}
