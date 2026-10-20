// Client-side companion to the permit training gate (migration
// permit_training_gate). The database is the authority — its triggers refuse
// to issue a permit while anyone on it is missing required training. These
// helpers only shape the same status rows for display and turn the
// trigger's error into something a supervisor can act on.

export const GATED_PERMIT_TYPES = ['confined_space', 'hot_work', 'working_at_heights', 'loto_group'] as const
export type GatedPermitType = typeof GATED_PERMIT_TYPES[number]

export const PERMIT_WORKER_ROLES = [
  'entrant', 'attendant', 'entry_supervisor', 'operator', 'fire_watch',
  'worker', 'competent_person', 'authorized_employee',
] as const
export type PermitWorkerRole = typeof PERMIT_WORKER_ROLES[number]

export type PermitTrainingState = 'current' | 'missing' | 'overridden'

/** One row of permit_training_status(): a crew member against one required module. */
export interface PermitTrainingStatusRow {
  member_id: string
  display_name: string
  module_id: string
  module_title: string
  status: PermitTrainingState
  expires_at: string | null
}

export interface PermitCrewTraining {
  memberId: string
  displayName: string
  ready: boolean
  modules: { moduleId: string; title: string; status: PermitTrainingState; expiresAt: string | null }[]
}

export interface PermitTrainingSummary {
  gated: boolean
  ready: boolean
  crew: PermitCrewTraining[]
  missingMemberIds: string[]
  overriddenCount: number
}

export function summarizePermitTraining(rows: PermitTrainingStatusRow[]): PermitTrainingSummary {
  const byMember = new Map<string, PermitCrewTraining>()
  for (const row of rows) {
    const entry = byMember.get(row.member_id) ?? { memberId: row.member_id, displayName: row.display_name, ready: true, modules: [] }
    entry.modules.push({ moduleId: row.module_id, title: row.module_title, status: row.status, expiresAt: row.expires_at })
    if (row.status === 'missing') entry.ready = false
    byMember.set(row.member_id, entry)
  }
  // Workers who still need training first: that is the list a supervisor acts on.
  const crew = [...byMember.values()].sort((a, b) => Number(a.ready) - Number(b.ready) || a.displayName.localeCompare(b.displayName))
  const missingMemberIds = crew.filter(c => !c.ready).map(c => c.memberId)
  return {
    gated: rows.length > 0,
    ready: missingMemberIds.length === 0,
    crew,
    missingMemberIds,
    overriddenCount: new Set(rows.filter(r => r.status === 'overridden').map(r => r.member_id)).size,
  }
}

const TRAINING_REQUIRED_PREFIX = 'TRAINING_REQUIRED:'

/**
 * The gate raises `TRAINING_REQUIRED: required training is missing for
 * Ana Ruiz — LOTO 101; …`. Returns the readable detail, or null when the
 * error is something else and should be shown as-is.
 */
export function parseTrainingRequiredError(message: string | null | undefined): string | null {
  if (!message) return null
  const at = message.indexOf(TRAINING_REQUIRED_PREFIX)
  if (at < 0) return null
  const detail = message.slice(at + TRAINING_REQUIRED_PREFIX.length).trim()
  return detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : 'Required training is missing.'
}

export const OVERRIDE_REASON_MIN_LENGTH = 20

export function validateOverrideReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length < OVERRIDE_REASON_MIN_LENGTH) {
    return `Explain the emergency in at least ${OVERRIDE_REASON_MIN_LENGTH} characters. It is audited and emailed to every owner and admin.`
  }
  return null
}
