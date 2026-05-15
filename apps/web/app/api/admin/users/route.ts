import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { generateTempPassword, supabaseAdmin } from '@/lib/supabaseAdmin'
import { normalizeEmail } from '@/lib/validation/tenants'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AUTH_PAGE_SIZE = 200
const AUTH_MAX_PAGES = 50

type TenantRole = 'owner' | 'admin' | 'member' | 'viewer'

interface ProfileLookup {
  id: string
  email: string | null
  full_name: string | null
  must_change_password?: boolean | null
}

interface AuthUserLookup {
  user: User | null
  error: { message: string } | null
}

function profileNameFromAuthUser(user: User): string | null {
  const value = user.user_metadata?.full_name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<AuthUserLookup> {
  const wanted = email.toLowerCase()

  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (error) return { user: null, error }

    const user = (data?.users ?? []).find(u => u.email?.toLowerCase() === wanted)
    if (user) return { user, error: null }
    if ((data?.users ?? []).length < AUTH_PAGE_SIZE) break
  }

  return { user: null, error: null }
}

async function ensureProfileForExistingAuthUser(
  admin: SupabaseClient,
  user: User,
  email: string,
  fullName: string,
): Promise<{ ok: true; profile: ProfileLookup } | { ok: false; error: { message: string } }> {
  const { data: profile, error: lookupErr } = await admin
    .from('profiles')
    .select('id, email, full_name, must_change_password')
    .eq('id', user.id)
    .maybeSingle()

  if (lookupErr) return { ok: false, error: lookupErr }

  const existing = profile as ProfileLookup | null
  if (existing) {
    const patch: Partial<Pick<ProfileLookup, 'email' | 'full_name'>> & { updated_at?: string } = {}
    if ((existing.email ?? '').toLowerCase() !== email) patch.email = email
    if (fullName && !existing.full_name) patch.full_name = fullName

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      const { error } = await admin.from('profiles').update(patch).eq('id', user.id)
      if (error) return { ok: false, error }
    }

    return { ok: true, profile: { ...existing, email, full_name: patch.full_name ?? existing.full_name } }
  }

  const createdProfile: ProfileLookup = {
    id: user.id,
    email,
    full_name: fullName || profileNameFromAuthUser(user),
    must_change_password: false,
  }
  const { error: insertErr } = await admin.from('profiles').insert(createdProfile)
  if (insertErr) return { ok: false, error: insertErr }

  return { ok: true, profile: createdProfile }
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

  const { data: existingProfile, error: profileLookupErr } = await admin
    .from('profiles')
    .select('id, email, full_name, must_change_password')
    .eq('email', email)
    .maybeSingle()
  if (profileLookupErr) return sanitizeError(profileLookupErr, 'admin/users/POST profile lookup')

  let userId: string
  let profileFullName = fullName || ((existingProfile as ProfileLookup | null)?.full_name ?? '')
  let tempPassword: string | undefined
  let alreadyExisted = !!existingProfile
  let createdAuthUser = false

  if (existingProfile) {
    const profile = existingProfile as ProfileLookup
    userId = profile.id
    if (fullName && !profile.full_name) {
      const { error } = await admin
        .from('profiles')
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq('id', userId)
      if (error) return sanitizeError(error, 'admin/users/POST profile name update')
      profileFullName = fullName
    }
  } else {
    tempPassword = generateTempPassword()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })

    if (createErr || !created.user) {
      const { user: authUser, error: authLookupErr } = await findAuthUserByEmail(admin, email)
      if (authLookupErr) return sanitizeError(authLookupErr, 'admin/users/POST auth lookup')
      if (!authUser) {
        return NextResponse.json({ error: createErr?.message ?? 'Could not create user' }, { status: 400 })
      }

      const profileResult = await ensureProfileForExistingAuthUser(admin, authUser, email, fullName)
      if (!profileResult.ok) return sanitizeError(profileResult.error, 'admin/users/POST profile repair')

      userId = authUser.id
      profileFullName = fullName || profileResult.profile.full_name || ''
      tempPassword = undefined
      alreadyExisted = true
    } else {
      userId = created.user.id
      createdAuthUser = true

      const { error: profErr } = await admin
        .from('profiles')
        .update({
          full_name: fullName || null,
          must_change_password: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
      if (profErr) {
        await admin.auth.admin.deleteUser(userId)
        return sanitizeError(profErr, 'admin/users/POST profile patch')
      }
    }
  }

  const role: TenantRole = 'member'
  const { error: membershipErr } = await admin
    .from('tenant_memberships')
    .insert({ user_id: userId, tenant_id: gate.tenantId, role, invited_by: gate.userId })
  if (membershipErr) {
    if ((membershipErr as { code?: string }).code === '23505') {
      if (createdAuthUser) await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: `${email} is already a member of this tenant` }, { status: 409 })
    }
    if (createdAuthUser) await admin.auth.admin.deleteUser(userId)
    return sanitizeError(membershipErr, 'admin/users/POST membership insert')
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

  const loginUrl = computeLoginUrl(req)
  const emailSent = await sendInviteEmail({
    to: email,
    fullName: profileFullName,
    tempPassword: tempPassword ?? '',
    loginUrl,
    tenantName: tenant.name,
  })

  return NextResponse.json({
    email,
    fullName: profileFullName,
    tempPassword,
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

  await admin
    .from('members')
    .update({ profile_id: null, status: 'archived', updated_by: gate.userId })
    .eq('tenant_id', gate.tenantId)
    .eq('profile_id', id)

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
