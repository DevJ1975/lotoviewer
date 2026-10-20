import { supabase } from '@/lib/supabase'
import type { GatedPermitType, PermitWorkerRole } from '@soteria/core/permitTrainingGate'

export interface CrewMember {
  memberId: string
  displayName: string
  role: PermitWorkerRole
}

export interface RosterMember {
  id: string
  display_name: string
  employee_id: string | null
  department: string | null
  position_title: string | null
}

export async function loadActiveRoster(tenantId: string): Promise<RosterMember[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id,display_name,employee_id,department,position_title')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('display_name', { ascending: true })
    .limit(2000)
  if (error) throw new Error(error.message)
  return (data ?? []) as RosterMember[]
}

export async function loadPermitCrew(tenantId: string, permitType: GatedPermitType, permitId: string): Promise<CrewMember[]> {
  const { data, error } = await supabase
    .from('permit_workers')
    .select('member_id,role,members:member_id(display_name)')
    .eq('tenant_id', tenantId)
    .eq('permit_type', permitType)
    .eq('permit_id', permitId)
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => {
    const member = Array.isArray(row.members) ? row.members[0] : row.members
    return { memberId: row.member_id as string, role: row.role as PermitWorkerRole, displayName: (member?.display_name as string) ?? 'Unknown' }
  })
}

/** Replaces the permit's crew with `crew`, touching only rows that changed. */
export async function savePermitCrew(tenantId: string, permitType: GatedPermitType, permitId: string, crew: CrewMember[]): Promise<void> {
  const existing = await loadPermitCrew(tenantId, permitType, permitId)
  const key = (c: { memberId: string; role: string }) => `${c.memberId}:${c.role}`
  const wanted = new Set(crew.map(key))
  const have = new Set(existing.map(key))

  const removed = existing.filter(c => !wanted.has(key(c)))
  for (const c of removed) {
    const { error } = await supabase.from('permit_workers').delete()
      .eq('permit_type', permitType).eq('permit_id', permitId).eq('member_id', c.memberId).eq('role', c.role)
    if (error) throw new Error(error.message)
  }

  const added = crew.filter(c => !have.has(key(c)))
  if (added.length > 0) {
    const { error } = await supabase.from('permit_workers').insert(
      added.map(c => ({ tenant_id: tenantId, permit_type: permitType, permit_id: permitId, member_id: c.memberId, role: c.role })),
    )
    if (error) throw new Error(error.message)
  }
}

/** Names for the legacy text[] roster columns, which print on the permit. */
export function crewNames(crew: CrewMember[], role: PermitWorkerRole): string[] {
  return crew.filter(c => c.role === role).map(c => c.displayName)
}

/** Roster entry for an app user or a shop-floor loto_worker (linked via members.source, migration 131). */
export async function resolveRosterMemberId(tenantId: string, person: { userId?: string | null; lotoWorkerId?: string | null }): Promise<string | null> {
  let query = supabase.from('members').select('id').eq('tenant_id', tenantId)
  if (person.userId) query = query.eq('profile_id', person.userId)
  else if (person.lotoWorkerId) query = query.eq('source', 'loto_worker').eq('source_id', person.lotoWorkerId)
  else return null
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.id as string | undefined) ?? null
}
