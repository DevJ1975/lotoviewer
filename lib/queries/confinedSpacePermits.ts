import { supabase } from '@/lib/supabase'
import type { ConfinedSpacePermit } from '@/lib/types'

// Confined-space permit queries. Same shape as lib/queries/equipment.ts
// — pure helpers that throw on Supabase error so callers can `try/catch`
// once instead of branching on `{ data, error }` per call. The win
// compounds when database.types.ts is generated: every helper here
// becomes type-narrowed in one place rather than 30+ inline call sites.

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (!result.data) throw new Error(`${what}: no data`)
  return result.data
}

// All permits within a date window (inclusive on both ends). Used by
// the compliance bundle generator and the inspector lookup endpoint —
// both want chronological permits in a window for a report.
export async function loadPermitsInWindow(args: {
  startTs: string   // ISO timestamp; caller normalises start-of-day
  endTs:   string   // ISO timestamp; caller normalises end-of-day
}): Promise<ConfinedSpacePermit[]> {
  const result = await supabase
    .from('loto_confined_space_permits')
    .select('*')
    .gte('started_at', args.startTs)
    .lte('started_at', args.endTs)
    .order('started_at', { ascending: true })
  return unwrap(result as { data: ConfinedSpacePermit[] | null; error: { message: string } | null }, 'loadPermitsInWindow')
}

// Single permit by id. Returns null when not found (PGRST116) so the
// caller can render a "permit not found" state without try/catch.
export async function loadPermit(permitId: string): Promise<ConfinedSpacePermit | null> {
  const { data, error } = await supabase
    .from('loto_confined_space_permits')
    .select('*')
    .eq('id', permitId)
    .single()
  if (error) {
    if (typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PGRST116') {
      return null
    }
    throw new Error(`loadPermit(${permitId}): ${error.message}`)
  }
  return data as ConfinedSpacePermit
}
