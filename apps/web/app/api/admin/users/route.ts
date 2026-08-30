import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { inviteIssueRateLimit } from '@/lib/rateLimit/inviteIssue'
import {
  ensureInvitedUser,
  ensureTenantMembership,
  issueAndSendInvite,
  provisionFailureResponse,
} from '@/lib/invites/provision'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { normalizeEmail } from '@/lib/validation/tenants'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AUTH_PAGE_SIZE = 200
const AUTH_MAX_PAGES = 50

type TenantRole = 'owner' | 'admin' | 'member' | 'viewer'

function profileNameFromAuthUser(user: User): string | null {
  const value = user.user_metadata?.full_name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function ensureCanonicalMember(args: {
  admin: SupabaseClient
  tenantId: string
  profileId: string
  email: string
  fullName: string
  actorUserId: string
  role: TenantRole
}) {
  const displayName = args.fullName || args.email
  const { error } = await args.admin
    .from('members')
    .insert({
      tenant_id: args.tenantId,
      profile_id: args.profileId,
      source: 'profile',
      legal_name: args.fullName || null,
      preferred_name: args.fullName || null,
      display_name: displayName,
      display_name_source: 'system',
      email: args.email,
      employment_type: 'employee',
      status: 'active',
      readiness_status: 'setup_needed',
      created_by: args.actorUserId,
      updated_by: args.actorUserId,
      metadata: { tenant_role: args.role, invited_via: 'admin_users' },
    })

  const code = (error as { code?: string } | null)?.code
  if (error && code !== '23505') throw error
}

async function rollbackInvite(admin: SupabaseClient, tenantId: string, userId: string, deleteAuthUser: boolean) {
  await admin.from('tenant_memberships').delete().eq('tenant_id', tenantId).eq('user_id', userId)
  if (deleteAuthUser) await admin.auth.admin.deleteUser(userId)
}

// POST /api/admin/users  { email, fullName? }
// Tenant-scoped invite. Creates/reuses the auth profile, grants membership in
// the active tenant, creates the canonical member row, then sends the invite.
export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limited = inviteIssueRateLimit(gate.userId)
  if (limited) return limited

  let body: { email?: unknown; fullName?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = normalizeEmail(body.email)
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (!email) return NextResponse.json({ error: 'Valid email required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name')
    .eq('id', gate.tenantId)
    .maybeSingle()
  if (tenantErr) return sanitizeError(tenantErr, 'admin/users/POST tenant')
  if (!tenant) return NextResponse.json({ error: 'Active tenant not found' }, { status: 404 })

  const invited = await ensureInvitedUser(admin, { email, fullName })
  if (!invited.ok) return provisionFailureResponse(invited, 'admin/users/POST')
  const { userId, createdAuthUser, tempPassword, alreadyExisted } = invited
  const profileFullName = invited.fullName

  const role: TenantRole = 'member'
  const membership = await ensureTenantMembership(admin, {
    userId, tenantId: gate.tenantId, role, invitedBy: gate.userId, onConflict: 'error',
  })
  if (!membership.ok) {
    if (createdAuthUser) await admin.auth.admin.deleteUser(userId)
    if (membership.status === 409) {
      return NextResponse.json({ error: `${email} is already a member of this tenant` }, { status: 409 })
    }
    return provisionFailureResponse(membership, 'admin/users/POST')
  }

  try {
    await ensureCanonicalMember({
      admin,
      tenantId: gate.tenantId,
      profileId: userId,
      email,
      fullName: profileFullName,
      actorUserId: gate.userId,
      role,
    })
  } catch (error) {
    await rollbackInvite(admin, gate.tenantId, userId, createdAuthUser)
    return sanitizeError(error, 'admin/users/POST member insert')
  }

  // Stale never-signed-in invitees get a fresh invite link too — a
  // passwordless "you've been added" notice would leave them stuck.
  const { inviteUrl, emailSent } = await issueAndSendInvite(admin, {
    userId,
    email,
    fullName:   profileFullName,
    tenantId:   gate.tenantId,
    tenantName: tenant.name,
    createdBy:  gate.userId,
    req,
    emailMode:  createdAuthUser || invited.mustChangePassword ? 'invite_link' : 'added_notification',
  })

  return NextResponse.json({
    email,
    fullName: profileFullName,
    tempPassword,
    // The raw invite link is a password-set credential for `userId`, so it
    // goes back to the caller ONLY for an account this call brought into
    // existence. profiles.email is globally unique (migration 003), so an
    // address that already has an account is REUSED rather than duplicated —
    // and an account that has never signed in is exactly the state of anyone
    // holding an outstanding invite at another tenant. Returning the link for
    // one of those handed this tenant's admin a working takeover primitive
    // against a person they have no relationship with: add the address, read
    // inviteUrl out of the response, set the password.
    //
    // Reused accounts still get their link — by email, to the address that
    // owns it. tempPassword is already limited this way: provision.ts sets it
    // only on the create path.
    inviteUrl: createdAuthUser ? inviteUrl : undefined,
    emailSent,
    alreadyExisted,
    tenantId: gate.tenantId,
  })
}

// GET /api/admin/users — list login users in the active tenant only.
export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data: memberships, error } = await admin
    .from('tenant_memberships')
    .select('user_id, role, created_at, profiles:user_id(email, full_name, is_admin, must_change_password)')
    .eq('tenant_id', gate.tenantId)
    .order('created_at', { ascending: false })
  if (error) return sanitizeError(error, 'admin/users/GET')

  const authById = new Map<string, User>()
  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const { data, error: authErr } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (authErr) return sanitizeError(authErr, 'admin/users/GET auth users')
    const users = data?.users ?? []
    for (const user of users) authById.set(user.id, user)
    if (users.length < AUTH_PAGE_SIZE) break
  }

  type RawProfile = {
    email: string | null
    full_name: string | null
    is_admin: boolean | null
    must_change_password: boolean | null
  }
  type RawMembership = {
    user_id: string
    role: TenantRole
    created_at: string
    profiles: RawProfile | RawProfile[] | null
  }

  const users = ((memberships ?? []) as unknown as RawMembership[]).map(row => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles
    const authUser = authById.get(row.user_id)
    return {
      id: row.user_id,
      email: profile?.email ?? authUser?.email ?? '',
      full_name: profile?.full_name ?? (authUser ? profileNameFromAuthUser(authUser) : null),
      is_admin: row.role === 'owner' || row.role === 'admin',
      role: row.role,
      must_change_password: profile?.must_change_password === true,
      created_at: row.created_at,
      last_sign_in_at: authUser?.last_sign_in_at ?? null,
    }
  })

  return NextResponse.json({ users })
}

// DELETE /api/admin/users?id=<uuid> — revoke this tenant's login access.
export async function DELETE(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Valid id required' }, { status: 400 })
  if (id === gate.userId) return NextResponse.json({ error: 'Cannot remove your own account' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: membership, error: membershipLookupErr } = await admin
    .from('tenant_memberships')
    .select('user_id, tenant_id, role')
    .eq('tenant_id', gate.tenantId)
    .eq('user_id', id)
    .maybeSingle()
  if (membershipLookupErr) return sanitizeError(membershipLookupErr, 'admin/users/DELETE membership lookup')
  if (!membership) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

  if ((membership as { role: TenantRole }).role === 'owner') {
    const { count, error: ownerErr } = await admin
      .from('tenant_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', gate.tenantId)
      .eq('role', 'owner')
    if (ownerErr) return sanitizeError(ownerErr, 'admin/users/DELETE owner count')
    if ((count ?? 0) <= 1) {
      return NextResponse.json({
        error: 'Cannot remove the last owner — promote another member to owner first',
      }, { status: 409 })
    }
  }

  const { data: authData } = await admin.auth.admin.getUserById(id)
  const lastSignInAt = authData?.user?.last_sign_in_at ?? null
  const { count: otherMemberships, error: otherErr } = await admin
    .from('tenant_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', id)
    .neq('tenant_id', gate.tenantId)
  if (otherErr) return sanitizeError(otherErr, 'admin/users/DELETE other memberships')

  const { error } = await admin
    .from('tenant_memberships')
    .delete()
    .eq('tenant_id', gate.tenantId)
    .eq('user_id', id)
  if (error) return sanitizeError(error, 'admin/users/DELETE membership delete')

  // Find the canonical member rows before we null profile_id so we
  // can emit a login_revoked event keyed on member_id (NOT auth.uid()
  // — the actor is the admin doing the revocation, not the user being
  // revoked).
  const { data: affectedMembers } = await admin
    .from('members')
    .select('id, metadata')
    .eq('tenant_id', gate.tenantId)
    .eq('profile_id', id)

  const archivedReasonPatch = {
    archived_reason: 'admin_removed',
    archived_at: new Date().toISOString(),
  }

  for (const row of (affectedMembers ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>) {
    const nextMetadata = { ...(row.metadata ?? {}), ...archivedReasonPatch }
    const { error: archiveErr } = await admin
      .from('members')
      .update({
        profile_id: null,
        status:     'archived',
        metadata:   nextMetadata,
        updated_by: gate.userId,
      })
      .eq('id', row.id)
    if (archiveErr) return sanitizeError(archiveErr, 'admin/users/DELETE member archive')

    const { error: eventErr } = await admin.from('member_status_events').insert({
      tenant_id:     gate.tenantId,
      member_id:     row.id,
      event_type:    'login_revoked',
      actor_user_id: gate.userId,
      reason:        'admin removed user via /admin/users',
      old_values:    { profile_id: id },
      new_values:    { profile_id: null, status: 'archived' },
    })
    if (eventErr) return sanitizeError(eventErr, 'admin/users/DELETE event insert')
  }

  const shouldDeleteNeverAcceptedInvite = !lastSignInAt && (otherMemberships ?? 0) === 0
  if (shouldDeleteNeverAcceptedInvite) {
    const { error: deleteErr } = await admin.auth.admin.deleteUser(id)
    if (deleteErr) {
      return NextResponse.json({
        ok: true,
        userDeleted: false,
        userDeleteError: deleteErr.message,
      })
    }
    return NextResponse.json({ ok: true, userDeleted: true })
  }

  return NextResponse.json({ ok: true, userDeleted: false })
}
