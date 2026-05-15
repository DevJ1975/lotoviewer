// §1910.147(g)(2) authorized-employee retraining triggers — pure helpers.
//
// The DB owns the triggers' creation (migration 142). The TypeScript
// side only has to:
//   - render the trigger type with a human label
//   - decide if a worker is "due" (any open trigger OR last_trained
//     more than 365 days ago)
//
// No DB, no React. Pure TS.

export type RetrainingTriggerType =
  | 'new_equipment'
  | 'new_hazards'
  | 'procedure_change'
  | 'deviation_observed'
  | 'periodic'

export const RETRAINING_TRIGGER_LABELS: Record<RetrainingTriggerType, string> = {
  new_equipment:      'New equipment',
  new_hazards:        'New hazards identified',
  procedure_change:   'Energy-isolation procedure changed',
  deviation_observed: 'Periodic inspection noted a deviation',
  periodic:           'Periodic retraining cadence',
}

export interface RetrainingTrigger {
  id: string
  tenant_id: string
  worker_id: string
  trigger_type: RetrainingTriggerType
  triggered_at: string
  resolved_at: string | null
  training_record_id: string | null
  reason: string | null
  equipment_id: string | null
  created_at: string
}

export interface WorkerRetrainingStatusRow {
  tenant_id: string
  worker_id: string
  full_name: string
  employee_id: string | null
  active: boolean
  last_trained_at: string | null
  open_trigger_count: number
}

// Cadence the standard does not pin, but most operators settle on
// annual. We surface a soft "due" badge when the worker's freshest
// authorized_employee cert is more than this many days old. The hard
// gate (locktag checkout block) still uses expires_at on the cert
// itself — this constant is only for the surfacing.
export const RETRAINING_CADENCE_DAYS = 365

export type RetrainingDueStatus = 'current' | 'due' | 'open_trigger' | 'never_trained'

/**
 * Decide whether a worker needs retraining attention.
 *
 * - never_trained: no authorized_employee record exists
 * - open_trigger: at least one unresolved §147(g)(2) trigger
 * - due: last training is older than the cadence
 * - current: trained within the cadence and no open trigger
 *
 * Open triggers outrank "due" because they identify a SPECIFIC reason
 * the cert is no longer adequate, not just a stale date.
 */
export function classifyRetraining(
  row: Pick<WorkerRetrainingStatusRow, 'last_trained_at' | 'open_trigger_count'>,
  asOf: Date,
): RetrainingDueStatus {
  if (row.open_trigger_count > 0) return 'open_trigger'
  if (!row.last_trained_at)       return 'never_trained'
  const lastMs = Date.parse(row.last_trained_at)
  if (Number.isNaN(lastMs))       return 'never_trained'
  const ageDays = (asOf.getTime() - lastMs) / (24 * 60 * 60 * 1000)
  if (ageDays > RETRAINING_CADENCE_DAYS) return 'due'
  return 'current'
}
