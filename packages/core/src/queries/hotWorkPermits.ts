import { supabase } from '../supabaseClient'
import type { HotWorkPermit } from '../types'

// Hot-work permit queries — same shape as confinedSpacePermits.ts.
// See lib/queries/equipment.ts for the rationale (centralisation
// pays off once database.types.ts lands).

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (!result.data) throw new Error(`${what}: no data`)
  return result.data
}

// All permits within a date window (inclusive). Used by compliance
// bundle + inspector flows.
export async function loadHotWorkPermitsInWindow(args: {
  startTs: string
  endTs:   string
}): Promise<HotWorkPermit[]> {
  const result = await supabase
    .from('loto_hot_work_permits')
    .select('*')
    .gte('started_at', args.startTs)
    .lte('started_at', args.endTs)
    .order('started_at', { ascending: true })
  return unwrap(result as { data: HotWorkPermit[] | null; error: { message: string } | null }, 'loadHotWorkPermitsInWindow')
}

// Single hot-work permit by id. Returns null when not found.
export async function loadHotWorkPermit(permitId: string): Promise<HotWorkPermit | null> {
  const { data, error } = await supabase
    .from('loto_hot_work_permits')
    .select('*')
    .eq('id', permitId)
    .single()
  if (error) {
    if (typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'PGRST116') {
      return null
    }
    throw new Error(`loadHotWorkPermit(${permitId}): ${error.message}`)
  }
  return data as HotWorkPermit
}

// Hot-work permits cross-linked to a specific CS permit (§1910.146(f)(15)).
// Pre-migration-019 the table doesn't exist — caller can handle the
// error to render an empty banner without crashing the surrounding page.
export async function loadHotWorkPermitsForCsPermit(csPermitId: string): Promise<HotWorkPermit[]> {
  const result = await supabase
    .from('loto_hot_work_permits')
    .select('*')
    .eq('associated_cs_permit_id', csPermitId)
    .order('started_at', { ascending: false })
  return unwrap(result as { data: HotWorkPermit[] | null; error: { message: string } | null }, 'loadHotWorkPermitsForCsPermit')
}
