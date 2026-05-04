import { supabase } from '../supabaseClient'
import type { Equipment } from '../types'

// Centralised loto_equipment queries. Pages used to inline these
// (often as `.select('*').order('equipment_id')` in 5+ places); the
// real win comes once database.types.ts is generated, but even before
// that, having one place to update when the equipment shape changes
// is worth the indirection. Adopt incrementally — pages that read
// only a subset of columns can stay inline until they're refactored.
//
// All helpers throw on Supabase error so callers can `try/catch` once
// instead of branching on { data, error } each call. The error message
// is preserved so the caller can surface it via formatSupabaseError.

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (!result.data) throw new Error(`${what}: no data`)
  return result.data
}

// All active + decommissioned equipment, ordered by equipment_id. Used by
// the LOTO main list, the decommission page, the status page, and the
// print queue's "all equipment" filter.
export async function loadAllEquipment(): Promise<Equipment[]> {
  const result = await supabase
    .from('loto_equipment')
    .select('*')
    .order('equipment_id', { ascending: true })
  return unwrap(result as { data: Equipment[] | null; error: { message: string } | null }, 'loadAllEquipment')
}

// Equipment for a single department. Used by the department detail page
// and the department-grouped print queue.
export async function loadEquipmentByDepartment(department: string): Promise<Equipment[]> {
  const result = await supabase
    .from('loto_equipment')
    .select('*')
    .eq('department', department)
    .order('equipment_id', { ascending: true })
  return unwrap(result as { data: Equipment[] | null; error: { message: string } | null }, 'loadEquipmentByDepartment')
}

// Single equipment by id. Used by the equipment detail page, the
// post-photo-upload reconcile, and elsewhere when we need a fresh row.
export async function loadEquipment(equipmentId: string): Promise<Equipment | null> {
  const { data, error } = await supabase
    .from('loto_equipment')
    .select('*')
    .eq('equipment_id', equipmentId)
    .single()
  if (error) {
    // PGRST116 == no rows found, which is a legitimate "missing" state
    // for the caller to handle, not an error.
    if (typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PGRST116') {
      return null
    }
    throw new Error(`loadEquipment(${equipmentId}): ${error.message}`)
  }
  return data as Equipment
}

// Print-queue subset: only equipment with a placard generated. The print
// page lists, optionally groups by department, and merges PDFs.
export async function loadPrintableEquipment(): Promise<Equipment[]> {
  const result = await supabase
    .from('loto_equipment')
    .select('*')
    .not('placard_url', 'is', null)
    .order('department')
  return unwrap(result as { data: Equipment[] | null; error: { message: string } | null }, 'loadPrintableEquipment')
}
