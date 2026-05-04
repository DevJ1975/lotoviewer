import { supabase } from '../supabaseClient'
import type { TrainingRecord } from '../types'

// Training records (migration 017).
//
// Pre-migration the table doesn't exist; callers that want a graceful
// "no records on file" fallback can use loadAllTrainingRecordsSafe()
// which returns an empty array on failure rather than throwing.

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (!result.data) throw new Error(`${what}: no data`)
  return result.data
}

// Throws on error. Use when the caller can surface a user-visible
// error (admin/training-records page).
export async function loadAllTrainingRecords(): Promise<TrainingRecord[]> {
  const result = await supabase
    .from('loto_training_records')
    .select('*')
    .order('completed_at', { ascending: false })
  return unwrap(result as { data: TrainingRecord[] | null; error: { message: string } | null }, 'loadAllTrainingRecords')
}

// Returns [] on any failure. Use on permit pages where the §(g) gate
// should default-pass (no records on file) rather than crashing the
// page when the table is missing or RLS denies the read.
export async function loadAllTrainingRecordsSafe(): Promise<TrainingRecord[]> {
  try {
    return await loadAllTrainingRecords()
  } catch {
    return []
  }
}
