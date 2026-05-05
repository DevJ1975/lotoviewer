import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { TenantRole } from '@soteria/core/types'

// GET    /api/superadmin/users/[user_id]
//   Detail bundle: profile + auth.users metadata + memberships across
//   every tenant + per-user audit feed (last 100 entries that name them
//   as actor, target row, or referenced user_id in a membership op).
//
// DELETE /api/superadmin/users/[user_id]
//   System-wide hard delete. Cascades through tenant_memberships +
//   profiles + auth.users.
//
// Both are superadmin-gated. The DELETE refuses to delete the caller
// or any user that's the last owner of a tenant.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface UserDetail {
  user_id:              string
  email:                string | null
  full_name:            string | null
  is_admin:             boolean
  is_superadmin:        boolean
  must_change_password: boolean
  last_sign_in_at:      string | null
  created_at:           string | null
  status:               'invited' | 'active'
  memberships: Array<{
    tenant_id:     string
    tenant_number: string
    tenant_name:   string
    role:          TenantRole
    joined_at:     string
  }>
  audit: Array<{
    id:         number
    occurred_at:string
    actor_email:string | null
    table_name: string
    operation:  string
    summary:    string
  }>
}

export async function GET(req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { user_id } = await ctx.params
  if (!UUID_RE.test(user_id)) {
    return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Profile
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('id, email, full_name, is_admin, is_superadmin, must_change_password, created_at')
    .eq('id', user_id)
    .maybeSingle()
  if (pErr) {
    Sentry.captureException(pErr, { tags: { route: '/api/superadmin/users/[user_id]', stage: 'profile' } })
    return NextResponse.json({ error: pErr.message }, { status: 500 })
  }
  if (!profile) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // auth.users metadata (last_sign_in_at)
  const { data: authUser } = await admin.auth.admin.getUserById(user_id)
  const lastSignInAt = authUser?.user?.last_sign_in_at ?? null

  // Memberships across every tenant
  const { data: mRows, error: mErr } = await admin
    .from('tenant_memberships')
    .select('role, created_at, tenant_id, tenants(id, tenant_number, name)')
    .eq('user_id', user_id)
    .order('created_at', { ascending: true })
  if (mErr) {
    Sentry.captureException(mErr, { tags: { route: '/api/superadmin/users/[user_id]', stage: 'memberships' } })
    return NextResponse.json({ error: mErr.message }, { status: 500 })
  }
  type RawMembership = {
    role: TenantRole; created_at: string; tenant_id: string
    tenants: { id: string; tenant_number: string; name: string } | { id: string; tenant_number: string; name: string }[] | null
  }
  const memberships = ((mRows ?? []) as RawMembership[])
    .map(r => {
      const t = Array.isArray(r.tenants) ? r.tenants[0] ?? null : r.tenants
      if (!t) return null
      return {
        tenant_id:     t.id,
        tenant_number: t.tenant_number,
        tenant_name:   t.name,
        role:          r.role,
        joined_at:     r.created_at,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // Per-user audit feed. Three OR'd cases on audit_log:
  //   - actor_id = user_id      (this user did something)
  //   - row_pk   = user_id      (someone changed THIS user's profile)
  //   - JSON content references the user_id (membership ops on this user)
  // We OR the simple cases server-side and post-filter the membership
  // case in JS to avoid building a JSONB query against an old shape.
  const { data: actorRows } = await admin
    .from('audit_log')
    .select('id, created_at, actor_email, table_name, operation, row_pk, new_row, old_row')
    .eq('actor_id', user_id)
    .order('created_at', { ascending: false })
    .limit(50)
  const { data: targetRows } = await admin
    .from('audit_log')
    .select('id, created_at, actor_email, table_name, operation, row_pk, new_row, old_row')
    .eq('row_pk', user_id)
    .order('created_at', { ascending: false })
    .limit(50)
  // Membership ops include the user_id inside new_row/old_row JSONB.
  // Pull recent membership rows and filter in JS — cheap at this scale.
  const { data: membershipRows } = await admin
    .from('audit_log')
    .select('id, created_at, actor_email, table_name, operation, row_pk, new_row, old_row')
    .eq('table_name', 'tenant_memberships')
    .order('created_at', { ascending: false })
    .limit(200)

  type RawAudit = {
    id: number; created_at: string; actor_email: string | null
    table_name: string; operation: string; row_pk: string | null
    new_row: Record<string, unknown> | null
    old_row: Record<string, unknown> | null
  }
  const dedup = new Map<number, RawAudit>()
  for (const r of (actorRows  ?? []) as RawAudit[]) dedup.set(r.id, r)
  for (const r of (targetRows ?? []) as RawAudit[]) dedup.set(r.id, r)
  for (const r of (membershipRows ?? []) as RawAudit[]) {
    const newU = (r.new_row?.user_id ?? '') as string
    const oldU = (r.old_row?.user_id ?? '') as string
    if (newU === user_id || oldU === user_id) dedup.set(r.id, r)
  }

  const audit = Array.from(dedup.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 100)
    .map(r => ({
      id:          r.id,
      occurred_at: r.created_at,
      actor_email: r.actor_email,
      table_name:  r.table_name,
      operation:   r.operation,
      summary:     summarize(r, user_id),
    }))

  const detail: UserDetail = {
    user_id,
    email:                profile.email ?? null,
    full_name:            profile.full_name ?? null,
    is_admin:             profile.is_admin === true,
    is_superadmin:        profile.is_superadmin === true,
    must_change_password: profile.must_change_password === true,
    last_sign_in_at:      lastSignInAt,
    created_at:           profile.created_at ?? null,
    status:               lastSignInAt ? 'active' : 'invited',
    memberships,
    audit,
  }

  return NextResponse.json({ user: detail })
}

// Best-effort one-line summary of an audit row from this user's POV.
function summarize(r: { table_name: string; operation: string; new_row: Record<string, unknown> | null; old_row: Record<string, unknown> | null }, userId: string): string {
  if (r.table_name === 'tenant_memberships') {
    const newRow = r.new_row ?? r.old_row ?? {}
    const role = newRow.role ?? r.old_row?.role
    if (r.operation === 'INSERT') return `Added to a tenant as ${role}`
    if (r.operation === 'DELETE') return `Removed from a tenant (was ${r.old_row?.role})`
    if (r.operation === 'UPDATE' && r.new_row?.role !== r.old_row?.role) {
      return `Role changed from ${r.old_row?.role} to ${r.new_row?.role}`
    }
    return `Membership ${r.operation}`
  }
  if (r.table_name === 'profiles') {
    if (r.operation === 'INSERT') return 'Profile created'
    if (r.operation === 'DELETE') return 'Profile deleted'
    return 'Profile updated'
  }
  // Acted-by-this-user: shorten to "{op} {table}".
  return `${r.operation} ${r.table_name}`
  void userId  // reserved for richer summaries later
}

export async function DELETE(req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { user_id } = await ctx.params
  // auth.users.id is a UUID. Tighten the check so a typo'd path can't
  // get past the first guard and reach the DB.
  if (!user_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)) {
    return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 })
  }

  if (user_id === gate.userId) {
    return NextResponse.json({
      error: 'Cannot delete your own account',
    }, { status: 400 })
  }

  const admin = supabaseAdmin()

  // Last-owner protection across all tenants the user belongs to.
  const { data: memberships } = await admin
    .from('tenant_memberships')
    .select('tenant_id, role')
    .eq('user_id', user_id)
  const ownedTenantIds = (memberships ?? []).filter(m => m.role === 'owner').map(m => m.tenant_id)
  for (const tenantId of ownedTenantIds) {
    const { count } = await admin
      .from('tenant_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return NextResponse.json({
        error: 'User is the last owner of at least one tenant. Promote another member to owner in each tenant first.',
      }, { status: 409 })
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user_id)
  if (error) {
    Sentry.captureException(error,
      { tags: { route: '/api/superadmin/users/[user_id]', stage: 'delete' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
