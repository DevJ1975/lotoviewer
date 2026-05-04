import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { TenantRole } from '@/lib/types'

// PATCH  /api/superadmin/tenants/[number]/members/[user_id]
//   Change role.
// DELETE /api/superadmin/tenants/[number]/members/[user_id]
//   Remove the membership.
//   ?cancel-invite=true  — also delete the auth.user from the system
//                          (only valid when status is 'invited' — i.e.
//                           last_sign_in_at is null AND no other tenant
//                           memberships). Used by the "Cancel invite"
//                           UI button so a typo'd email doesn't leave
//                           an orphan account behind.
//
// Both routes refuse to leave a tenant ownerless: if the membership being
// changed/removed is the last 'owner', the request fails with 409. Promote
// another member to owner first, then retry.

const VALID_ROLES: ReadonlySet<TenantRole> =
  new Set<TenantRole>(['owner', 'admin', 'member', 'viewer'])

async function loadContext(number: string, userId: string) {
  const admin = supabaseAdmin()

  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .select('id, tenant_number')
    .eq('tenant_number', number)
    .maybeSingle()
  if (tErr) return { admin, error: tErr, status: 500 as const }
  if (!tenant) return { admin, error: new Error('Tenant not found'), status: 404 as const }

  const { data: membership, error: mErr } = await admin
    .from('tenant_memberships')
    .select('user_id, tenant_id, role')
    .eq('tenant_id', tenant.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (mErr) return { admin, error: mErr, status: 500 as const }
  if (!membership) return { admin, error: new Error('Membership not found'), status: 404 as const }

  return { admin, tenant, membership }
}

async function ownerCount(admin: ReturnType<typeof supabaseAdmin>, tenantId: string): Promise<number> {
  const { count } = await admin
    .from('tenant_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
  return count ?? 0
}

export async function PATCH(req: Request, ctx: { params: Promise<{ number: string; user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number, user_id } = await ctx.params
  if (!/^[0-9]{4}$/.test(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  let body: { role?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const role = body.role as TenantRole
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const ctxOrErr = await loadContext(number, user_id)
  if ('error' in ctxOrErr && ctxOrErr.error) {
    return NextResponse.json({ error: ctxOrErr.error.message }, { status: ctxOrErr.status })
  }
  const { admin, tenant, membership } = ctxOrErr as Required<typeof ctxOrErr>

  // Last-owner protection: refuse to demote the only owner.
  if (membership.role === 'owner' && role !== 'owner') {
    const owners = await ownerCount(admin, tenant.id)
    if (owners <= 1) {
      return NextResponse.json({
        error: 'Cannot demote the last owner — promote another member to owner first',
      }, { status: 409 })
    }
  }

  if (membership.role === role) {
    return NextResponse.json({ membership })  // no-op
  }

  const { data, error } = await admin
    .from('tenant_memberships')
    .update({ role })
    .eq('tenant_id', tenant.id)
    .eq('user_id', user_id)
    .select('user_id, tenant_id, role, created_at, updated_at')
    .maybeSingle()
  if (error) {
    Sentry.captureException(error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ membership: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ number: string; user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number, user_id } = await ctx.params
  if (!/^[0-9]{4}$/.test(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  const cancelInvite = new URL(req.url).searchParams.get('cancel-invite') === 'true'

  const ctxOrErr = await loadContext(number, user_id)
  if ('error' in ctxOrErr && ctxOrErr.error) {
    return NextResponse.json({ error: ctxOrErr.error.message }, { status: ctxOrErr.status })
  }
  const { admin, tenant, membership } = ctxOrErr as Required<typeof ctxOrErr>

  if (membership.role === 'owner') {
    const owners = await ownerCount(admin, tenant.id)
    if (owners <= 1) {
      return NextResponse.json({
        error: 'Cannot remove the last owner — promote another member to owner first',
      }, { status: 409 })
    }
  }

  // For cancel-invite, verify the user really hasn't accepted: never
  // signed in AND no other tenant memberships. If they have accepted
  // somewhere, fall back to the regular "remove from this tenant only"
  // path so we don't accidentally nuke an active account.
  let alsoDeleteUser = false
  if (cancelInvite) {
    const { data: authUser } = await admin.auth.admin.getUserById(user_id)
    const lastSignIn = authUser?.user?.last_sign_in_at ?? null
    const { count: otherMemberships } = await admin
      .from('tenant_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .neq('tenant_id', tenant.id)
    if (lastSignIn === null && (otherMemberships ?? 0) === 0) {
      alsoDeleteUser = true
    }
  }

  const { error } = await admin
    .from('tenant_memberships')
    .delete()
    .eq('tenant_id', tenant.id)
    .eq('user_id', user_id)
  if (error) {
    Sentry.captureException(error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (alsoDeleteUser) {
    const { error: delUserErr } = await admin.auth.admin.deleteUser(user_id)
    if (delUserErr) {
      Sentry.captureException(delUserErr)
      // Don't 500 — the membership was already removed cleanly. Surface
      // the user-delete failure so the UI can warn the superadmin.
      return NextResponse.json({
        ok:           true,
        userDeleted:  false,
        userDeleteError: delUserErr.message,
      })
    }
    return NextResponse.json({ ok: true, userDeleted: true })
  }

  return NextResponse.json({ ok: true, userDeleted: false })
}
