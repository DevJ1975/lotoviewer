import { supabase } from './supabase'
import type { DepartmentStats, LotoReview } from '@soteria/core/types'

// Renames every equipment row in oldName to newName via a single bulk PATCH.
// No-ops if the new name is empty or unchanged. Throws on Supabase error.
export async function renameDepartment(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim()
  if (!trimmed || trimmed === oldName) return

  const { error } = await supabase
    .from('loto_equipment')
    .update({ department: trimmed })
    .eq('department', oldName)

  if (error) throw new Error(error.message)
}

// Applies a local rename to the dept-stats array without refetching.
// When newName already exists, the two rows are merged and pct recomputed.
export function applyRenameToStats(
  prev: DepartmentStats[],
  oldName: string,
  newName: string,
): DepartmentStats[] {
  if (!newName || newName === oldName) return prev
  const old = prev.find(s => s.department === oldName)
  if (!old) return prev

  const existing = prev.find(s => s.department === newName)
  if (!existing) {
    return prev.map(s => (s.department === oldName ? { ...s, department: newName } : s))
  }

  const total    = existing.total    + old.total
  const complete = existing.complete + old.complete
  const merged: DepartmentStats = {
    department: newName,
    total,
    complete,
    partial: existing.partial + old.partial,
    missing: existing.missing + old.missing,
    pct: total > 0 ? Math.round((complete / total) * 100) : 0,
  }
  return prev
    .filter(s => s.department !== oldName && s.department !== newName)
    .concat(merged)
}

// Re-keys a "latest review per department" map so the review stored under
// oldName is surfaced under newName. If both keys already exist we keep the
// one already at newName (it's the more recent state in the current session).
export function applyRenameToReviews(
  prev: Record<string, LotoReview>,
  oldName: string,
  newName: string,
): Record<string, LotoReview> {
  if (!newName || newName === oldName) return prev
  if (!prev[oldName]) return prev
  const next = { ...prev }
  if (!next[newName]) next[newName] = next[oldName]
  delete next[oldName]
  return next
}
