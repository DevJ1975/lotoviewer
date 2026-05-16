import { supabase } from '@/lib/supabase'
import type { MemberProfilePatch, MemberSearchResult, MemberSummary } from '@/lib/members/types'

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function tenantHeader(tenantId: string): Record<string, string> {
  return { 'x-active-tenant': tenantId }
}

async function jsonHeaders(tenantId: string): Promise<Record<string, string>> {
  return {
    'content-type': 'application/json',
    ...tenantHeader(tenantId),
    ...(await authHeader()),
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return json as T
}

export async function searchMembers(
  tenantId: string,
  opts: { q?: string; includeArchived?: boolean; limit?: number } = {},
): Promise<MemberSearchResult[]> {
  const u = new URL('/api/members/search', window.location.origin)
  if (opts.q) u.searchParams.set('q', opts.q)
  if (opts.includeArchived) u.searchParams.set('includeArchived', '1')
  if (opts.limit) u.searchParams.set('limit', String(opts.limit))
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const json = await readJson<{ members: MemberSearchResult[] }>(res)
  return json.members
}

export async function getMyMemberProfile(tenantId: string): Promise<MemberSummary | null> {
  const res = await fetch('/api/members/me', {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const json = await readJson<{ member: MemberSummary | null }>(res)
  return json.member
}

export async function updateMyMemberProfile(
  tenantId: string,
  patch: MemberProfilePatch,
): Promise<MemberSummary> {
  const res = await fetch('/api/members/me', {
    method: 'PATCH',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(patch),
  })
  const json = await readJson<{ member: MemberSummary }>(res)
  return json.member
}

export async function listAdminMembers(
  tenantId: string,
  opts: { q?: string; includeArchived?: boolean; limit?: number } = {},
): Promise<MemberSearchResult[]> {
  const u = new URL('/api/admin/members', window.location.origin)
  if (opts.q) u.searchParams.set('q', opts.q)
  if (opts.includeArchived) u.searchParams.set('includeArchived', '1')
  if (opts.limit) u.searchParams.set('limit', String(opts.limit))
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const json = await readJson<{ members: MemberSearchResult[] }>(res)
  return json.members
}

export interface GrantLoginResult {
  memberId:     string
  profileId:    string
  tempPassword: string | null
  emailSent:    boolean
}

export async function grantMemberLogin(
  tenantId: string,
  memberId: string,
  body: { email?: string; fullName?: string } = {},
): Promise<GrantLoginResult> {
  const res = await fetch(`/api/admin/members/${memberId}/grant-login`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(body),
  })
  return readJson<GrantLoginResult>(res)
}

export async function mergeMembers(
  tenantId: string,
  body: { sourceMemberId: string; targetMemberId: string; reason: string },
): Promise<{ targetMemberId: string }> {
  const res = await fetch('/api/admin/members/merge', {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(body),
  })
  return readJson<{ targetMemberId: string }>(res)
}

export async function patchAdminMember(
  tenantId: string,
  memberId: string,
  patch: Partial<MemberSummary>,
): Promise<MemberSummary> {
  const res = await fetch(`/api/admin/members/${memberId}`, {
    method: 'PATCH',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(patch),
  })
  const json = await readJson<{ member: MemberSummary }>(res)
  return json.member
}
