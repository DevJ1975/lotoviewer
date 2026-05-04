import type { Equipment } from './types'

export interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Partial<Equipment>
  old: Partial<Equipment>
}

// Apply a single Supabase postgres_changes payload to our local equipment list.
// Kept pure (no hooks, no side effects) so it can be tested and reused.
//
// Contract:
//   - DELETE removes a row by old.equipment_id (no-op if id missing or unknown).
//   - INSERT for a new id appends + re-sorts by equipment_id.
//   - INSERT for an existing id behaves like UPDATE (idempotent against duplicates).
//   - UPDATE for a known id replaces in-place (preserves array order).
//   - UPDATE for an unknown id treats it as an INSERT — covers the case where
//     the initial fetch raced the realtime subscription and we missed the INSERT.
//   - Payloads missing new.equipment_id are ignored (defensive).
export function reconcileEquipment(prev: Equipment[], payload: RealtimePayload): Equipment[] {
  if (payload.eventType === 'DELETE') {
    const oldId = payload.old?.equipment_id
    if (!oldId) return prev
    const next = prev.filter(e => e.equipment_id !== oldId)
    return next.length === prev.length ? prev : next
  }

  const row = payload.new as Equipment | undefined
  if (!row?.equipment_id) return prev

  const idx = prev.findIndex(e => e.equipment_id === row.equipment_id)
  if (idx === -1) {
    const next = [...prev, row]
    next.sort((a, b) => a.equipment_id.localeCompare(b.equipment_id))
    return next
  }

  // Reference-equal return when the row is byte-identical avoids unnecessary
  // re-renders downstream. Cheap shallow compare of the fields we track.
  const current = prev[idx]
  if (shallowEqualEquipment(current, row)) return prev

  const next = prev.slice()
  next[idx] = row
  return next
}

// Annotations are stored as JSON-array columns; Supabase materializes
// them as a fresh JS array on every fetch, so a `!==` reference check
// would reject the optimization for any equipment that has
// annotations (i.e. every annotated row, every realtime tick). Compare
// these two fields structurally so the optimization actually fires.
const ARRAY_FIELDS: ReadonlyArray<keyof Equipment> = ['annotations', 'iso_annotations']

function arraysShallowEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  // JSON-compare is fine: typical placards have <10 annotation entries.
  // Switch to a per-element structural compare if profiling ever
  // surfaces this as hot.
  return JSON.stringify(a) === JSON.stringify(b)
}

function shallowEqualEquipment(a: Equipment, b: Equipment): boolean {
  const keys = Object.keys(a) as (keyof Equipment)[]
  if (keys.length !== Object.keys(b).length) return false
  for (const k of keys) {
    if (ARRAY_FIELDS.includes(k)) {
      if (!arraysShallowEqual(a[k] as unknown[], b[k] as unknown[])) return false
      continue
    }
    if (a[k] !== b[k]) return false
  }
  return true
}
