import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeMemberQuery, type MemberSearchResult, type MemberSummary } from '@/lib/members/types'

type RosterRow = {
  member_id: string
  tenant_id: string
  profile_id: string | null
  handle: string
  member_code: string
  display_name: string
  display_name_source: MemberSummary['display_name_source'] | null
  legal_name: string | null
  preferred_name: string | null
  pronouns: string | null
  email: string | null
  phone: string | null
  employee_id: string | null
  badge_id: string | null
  employment_type: MemberSummary['employment_type']
  vendor_company: string | null
  department: string | null
  site_label: string | null
  position_title: string | null
  shift_label: string | null
  supervisor_member_id: string | null
  supervisor_name: string | null
  language: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  notification_preferences: Record<string, unknown> | null
  readiness_status: MemberSummary['readiness_status']
  status: MemberSummary['status']
  avatar_url: string | null
  tenant_role: MemberSummary['tenant_role']
  is_admin: boolean | null
  is_superadmin: boolean | null
  created_at: string
  updated_at: string
}

export function toMemberSummary(row: RosterRow): MemberSummary {
  return {
    ...row,
    user_id: row.profile_id,
    display_name_source: row.display_name_source ?? 'system',
    notification_preferences: row.notification_preferences ?? null,
  }
}

export function decorateMember(row: MemberSummary): MemberSearchResult {
  const parts = [
    row.position_title,
    row.department,
    row.shift_label,
    row.employee_id ? `ID ${row.employee_id}` : null,
    row.email,
  ].filter(Boolean)
  return {
    ...row,
    mention_label: row.display_name,
    mention_subtitle: parts.join(' · '),
  }
}

export function memberMatchesQuery(row: MemberSummary, query: string): boolean {
  const q = normalizeMemberQuery(query)
  if (!q) return true
  const haystack = [
    row.display_name,
    row.legal_name,
    row.preferred_name,
    row.handle,
    row.member_code,
    row.email,
    row.phone,
    row.employee_id,
    row.badge_id,
    row.vendor_company,
    row.department,
    row.site_label,
    row.position_title,
    row.shift_label,
    row.supervisor_name,
    row.employment_type,
    row.status,
    row.readiness_status,
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(q)
}

export async function listMembersForTenant(
  client: SupabaseClient,
  tenantId: string,
  opts: { q?: string; includeArchived?: boolean; limit?: number } = {},
): Promise<MemberSearchResult[]> {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 500)
  let query = client
    .from('v_member_roster')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('display_name', { ascending: true })
    .limit(limit * 2)

  if (!opts.includeArchived) {
    query = query.eq('status', 'active')
  }

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as RosterRow[])
    .map(toMemberSummary)
    .filter(row => memberMatchesQuery(row, opts.q ?? ''))
    .slice(0, limit)
    .map(decorateMember)
}

export async function getMemberForProfile(
  client: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<MemberSummary | null> {
  const { data, error } = await client
    .from('v_member_roster')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw error
  return data ? toMemberSummary(data as RosterRow) : null
}

export async function getOrCreateMemberForProfile(
  client: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<MemberSummary | null> {
  const existing = await getMemberForProfile(client, tenantId, profileId)
  if (existing) return existing

  const { data: membership, error: membershipErr } = await client
    .from('tenant_memberships')
    .select('tenant_id, user_id, role')
    .eq('tenant_id', tenantId)
    .eq('user_id', profileId)
    .maybeSingle()
  if (membershipErr) throw membershipErr
  if (!membership) return null

  const { data: profile, error: profileErr } = await client
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', profileId)
    .maybeSingle()
  if (profileErr) throw profileErr
  if (!profile) return null

  const profileRow = profile as { id: string; email: string | null; full_name: string | null }
  const displayName = profileRow.full_name?.trim() || profileRow.email?.trim() || 'Member'

  const { error: insertErr } = await client
    .from('members')
    .insert({
      tenant_id: tenantId,
      profile_id: profileId,
      source: 'profile',
      legal_name: profileRow.full_name,
      preferred_name: profileRow.full_name,
      display_name: displayName,
      display_name_source: 'system',
      email: profileRow.email,
      employment_type: 'employee',
      status: 'active',
      readiness_status: 'setup_needed',
      created_by: profileId,
      updated_by: profileId,
    })
  if (insertErr && insertErr.code !== '23505') throw insertErr

  return getMemberForProfile(client, tenantId, profileId)
}

export function isMissingMembersSchema(error: unknown): boolean {
  const err = error as { code?: string; message?: string; details?: string; hint?: string } | null
  const code = err?.code ?? ''
  if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)) return true
  const text = `${err?.message ?? ''} ${err?.details ?? ''} ${err?.hint ?? ''}`
  return /v_member_roster|members|schema cache|relation .* does not exist|column .* does not exist/i.test(text)
}
