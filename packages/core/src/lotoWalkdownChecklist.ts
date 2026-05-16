// §1910.147(c)(6) walkdown checklist — shape + completion validator.
//
// The DB stores the items array as opaque jsonb; this module pins the
// shape so the editor + the signoff button agree, and provides the
// "is the checklist complete" predicate the signoff guard relies on.

export type WalkdownItemStatus = 'pass' | 'fail' | 'n_a' | 'pending'

export const WALKDOWN_ITEM_STATUS_LABELS: Record<WalkdownItemStatus, string> = {
  pass:    'Pass',
  fail:    'Fail',
  n_a:     'N/A',
  pending: 'Not yet inspected',
}

export interface WalkdownItem {
  id: string
  label: string
  /** Status of the inspection check. */
  status: WalkdownItemStatus
  /** Inspector notes — required when status === 'fail'. */
  notes: string | null
  /** Optional photo evidence URL (stored in loto-photos bucket). */
  photo_url: string | null
}

export interface WalkdownChecklistRow {
  id: string
  tenant_id: string
  equipment_id: string
  walkdown_date: string
  items: WalkdownItem[]
  completed_by_user_id: string | null
  completed_by_name: string
  signed: boolean
  signed_name: string | null
  signature: string | null
  signed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// The default checklist enumerates the six items §147(c)(6) requires
// the periodic inspection to cover. Operators can add custom items via
// the editor; these are the floor.
export function defaultWalkdownItems(): WalkdownItem[] {
  return [
    { id: 'procedure_available',     label: 'Procedure available at point of use',  status: 'pending', notes: null, photo_url: null },
    { id: 'sources_match',           label: 'Energy sources match procedure',       status: 'pending', notes: null, photo_url: null },
    { id: 'lock_points_accessible',  label: 'Lock points accessible',                status: 'pending', notes: null, photo_url: null },
    { id: 'tryout_verified',         label: 'Try-out step verified',                 status: 'pending', notes: null, photo_url: null },
    { id: 'workers_can_demonstrate', label: 'Authorized employees can demonstrate',  status: 'pending', notes: null, photo_url: null },
    { id: 'tags_legible',            label: 'Tags legible',                          status: 'pending', notes: null, photo_url: null },
  ]
}

export interface ChecklistCompletionResult {
  /** True when every item is non-pending. */
  complete: boolean
  pending: WalkdownItem[]
  /** Failed items must have notes — surfaces missing-notes items here. */
  fails_without_notes: WalkdownItem[]
}

/**
 * §147(c)(6) compliance gate: a walkdown can be signed when every
 * item has been inspected (status !== 'pending') AND every fail has
 * a notes value explaining the gap. N/A is allowed without notes
 * because the operator's "this item doesn't apply to this equipment"
 * is itself the documentation.
 */
export function checklistCompletion(items: WalkdownItem[]): ChecklistCompletionResult {
  const pending = items.filter(i => i.status === 'pending')
  const fails_without_notes = items.filter(
    i => i.status === 'fail' && (!i.notes || i.notes.trim().length === 0),
  )
  return {
    complete: pending.length === 0 && fails_without_notes.length === 0,
    pending,
    fails_without_notes,
  }
}
