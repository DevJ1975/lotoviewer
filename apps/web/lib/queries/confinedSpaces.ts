import { supabase } from '@/lib/supabase'
import type { ConfinedSpace } from '@/lib/types'

// Confined-space inventory queries.

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (!result.data) throw new Error(`${what}: no data`)
  return result.data
}

// Single space by space_id. Returns null when not found.
export async function loadConfinedSpace(spaceId: string): Promise<ConfinedSpace | null> {
  const { data, error } = await supabase
    .from('loto_confined_spaces')
    .select('*')
    .eq('space_id', spaceId)
    .single()
  if (error) {
    if (typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PGRST116') {
      return null
    }
    throw new Error(`loadConfinedSpace(${spaceId}): ${error.message}`)
  }
  return data as ConfinedSpace
}

// Spaces by id list — used when batching a permit list back to its
// parent spaces (compliance bundle, inspector lookup). Empty input →
// empty output without a roundtrip.
export async function loadConfinedSpacesByIds(spaceIds: string[]): Promise<ConfinedSpace[]> {
  if (spaceIds.length === 0) return []
  const result = await supabase
    .from('loto_confined_spaces')
    .select('*')
    .in('space_id', spaceIds)
  return unwrap(result as { data: ConfinedSpace[] | null; error: { message: string } | null }, 'loadConfinedSpacesByIds')
}
