// Group LOTO permit invariants — pure helpers.
//
// The database enforces the same rules via the close_loto_group_permit /
// handoff_loto_group_permit RPCs (migration 143). The TypeScript side
// duplicates the check so the UI can disable buttons before the user
// hits "Close" and gets a server error.

export type LotoGroupPermitStatus = 'open' | 'shift_handed_off' | 'closed'

export interface LotoGroupPermit {
  id: string
  tenant_id: string
  primary_authorized_employee_id: string | null
  work_description: string
  equipment_ids: string[]
  started_at: string
  ended_at: string | null
  status: LotoGroupPermitStatus
  close_notes: string | null
  created_at: string
  updated_at: string
}

export interface LotoGroupPermitMember {
  id: string
  group_permit_id: string
  worker_id: string | null
  user_id: string | null
  personal_lock_serial: string
  joined_at: string
  left_at: string | null
  notes: string | null
}

export interface LotoGroupPermitHandoff {
  id: string
  group_permit_id: string
  from_user_id: string
  to_user_id: string
  occurred_at: string
  notes: string | null
}

export interface ClosePermitInvariant {
  canClose: boolean
  /** Human-readable reason the permit can't be closed yet. */
  reason: string | null
}

/**
 * §147(f)(3) — every personal lock must be removed before the group
 * box is opened. The UI disables the close button when any member
 * still has a personal lock attached (left_at IS NULL).
 */
export function canClosePermit(
  permit: Pick<LotoGroupPermit, 'status'>,
  members: Pick<LotoGroupPermitMember, 'left_at'>[],
): ClosePermitInvariant {
  if (permit.status === 'closed') {
    return { canClose: false, reason: 'Permit is already closed.' }
  }
  const attached = members.filter(m => m.left_at == null).length
  if (attached > 0) {
    return {
      canClose: false,
      reason: `${attached} member${attached === 1 ? '' : 's'} still attached — every personal lock must be removed first.`,
    }
  }
  return { canClose: true, reason: null }
}

export interface AddMemberInvariant {
  canAdd: boolean
  reason: string | null
}

/**
 * §147(f)(3)(ii)(A) — the primary authorized employee carries
 * accountability for the group. We refuse to add members until the
 * primary is set on the permit, and we refuse on closed permits.
 */
export function canAddMember(
  permit: Pick<LotoGroupPermit, 'status' | 'primary_authorized_employee_id'>,
): AddMemberInvariant {
  if (permit.status === 'closed') {
    return { canAdd: false, reason: 'Cannot add members to a closed permit.' }
  }
  if (!permit.primary_authorized_employee_id) {
    return { canAdd: false, reason: 'Assign a primary authorized employee before adding members.' }
  }
  return { canAdd: true, reason: null }
}
