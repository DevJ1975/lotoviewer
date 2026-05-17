import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { generateTempPassword, supabaseAdmin } from '@/lib/supabaseAdmin'
import { normalizeEmail } from '@/lib/validation/tenants'

// POST /api/admin/members/[memberId]/grant-login
//
// Grants app login access to an existing members row that doesn't yet
// have a profile_id. The shape mirrors /api/admin/users POST (creates
// or reuses an auth.users row, ensures a profiles row, ensures a
// tenant_memberships row) but UPDATES the existing members row instead
// of inserting a fresh one — that's the whole point of the unified
// roster.
//
// TODO(phase-2): extract a shared invite helper. The auth+profile+
// membership block here is the second occurrence of that flow (first
// is /api/admin/users POST); Rule of Three says extract on the third.
// For now the two copies stay inline so each route reads top-to-bottom.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AUTH_PAGE_SIZE = 200
const AUTH_MAX_PAGES = 50

type TenantRole = 'owner' | 'admin' | 'member' | 'viewer'

interface RouteContext { params: Promise<{ memberId: string }> }

interface MemberRow {
  id:           string
  tenant_id:    string
  profile_id:   string | null
  email:        string | null
  legal_name:   string | null
  display_name: string
}

async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.toLowerCase()
  for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    if (error) throw error
    const user = (data?.users ?? []).find(u => u.email?.toLowerCase() === wanted)
    if (user) return user
    if ((data?.users ?? []).length < AUTH_PAGE_SIZE) return null
  }
  return null
}

export async function POST(req: Request, ctx: RouteContext) {
  const { memberId } = await ctx.params
  if (!UUID_RE.test(memberId)) {
    return NextResponse.json({ error: 'Invalid member id' }, { status: 400 })
  }

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { email?: unknown; fullName?: unknown }
  try { body = await req.json().catch(() => ({})) }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = supabaseAdmin()

  const { data: memberData, error: memberErr } = await admin
    .from('members')
    .select('id, tenant_id, profile_id, email, legal_name, display_name')
    .eq('id', memberId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (memberErr) return sanitizeError(memberErr, 'admin/members/grant-login member lookup')
  if (!memberData) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const member = memberData as MemberRow
  if (member.profile_id) {
    return NextResponse.json({
      error: 'ALREADY_HAS_LOGIN',
      message: 'This member is already linked to a login account.',
    }, { status: 409 })
  }

  const overrideEmail = typeof body.email === 'string' ? body.email : ''
  const overrideName  = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const email = normalizeEmail(overrideEmail || member.email || '')
  if (!email) {
    return NextResponse.json({
      error: 'EMAIL_REQUIRED',
      message: 'This member has no email on file. Pass an email in the request body.',
    }, { status: 400 })
  }
  const fullName = overrideName || member.legal_name?.trim() || member.display_name || ''

  // Tenant context for the email subject line.
  const { data: tenantData, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name')
    .eq('id', gate.tenantId)
    .maybeSingle()
  if (tenantErr) return sanitizeError(tenantErr, 'admin/members/grant-login tenant lookup')
  if (!tenantData) return NextResponse.json({ error: 'Active tenant not found' }, { status: 404 })

  // ── auth.users + profiles: reuse if email already exists, else create.
  let userId: string
  let tempPassword: string | undefined

  const { data: existingProfile, error: profileLookupErr } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .eq('email', email)
    .maybeSingle()
  if (profileLookupErr) return sanitizeError(profileLookupErr, 'admin/members/grant-login profile lookup')

  if (existingProfile) {
    userId = (existingProfile as { id: string }).id
    // Patch the profile name only when caller supplied one and it's
    // currently empty — never clobber a user-edited name.
    if (fullName && !(existingProfile as { full_name: string | null }).full_name) {
      await admin
        .from('profiles')
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq('id', userId)
    }
  } else {
    tempPassword = generateTempPassword()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })

    if (createErr || !created?.user) {
      // Stale auth.users row with no profiles row: reuse it.
      let stale: User | null = null
      try { stale = await findAuthUserByEmail(admin, email) }
      catch (err) { return sanitizeError(err, 'admin/members/grant-login auth listUsers') }
      if (!stale) {
        return NextResponse.json({
          error: createErr?.message ?? 'Could not create auth user',
        }, { status: 400 })
      }
      userId = stale.id
      tempPassword = undefined
      const { error: insertProfileErr } = await admin
        .from('profiles')
        .insert({
          id: userId,
          email,
          full_name: fullName || null,
          must_change_password: false,
        })
      if (insertProfileErr && (insertProfileErr as { code?: string }).code !== '23505') {
        return sanitizeError(insertProfileErr, 'admin/members/grant-login profile repair')
      }
    } else {
      userId = created.user.id
      const { error: profileUpdateErr } = await admin
        .from('profiles')
        .update({
          full_name: fullName || null,
          must_change_password: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
      if (profileUpdateErr) {
        await admin.auth.admin.deleteUser(userId)
        return sanitizeError(profileUpdateErr, 'admin/members/grant-login profile patch')
      }
    }
  }

  // ── tenant_memberships: idempotent (a 23505 here just means the
  // user was already a member of this tenant under a different members
  // row — that's the merge candidate the admin probably wants).
  const role: TenantRole = 'member'
  const { error: membershipErr } = await admin
    .from('tenant_memberships')
    .insert({
      user_id:    userId,
      tenant_id:  gate.tenantId,
      role,
      invited_by: gate.userId,
    })
  if (membershipErr && (membershipErr as { code?: string }).code !== '23505') {
    return sanitizeError(membershipErr, 'admin/members/grant-login membership insert')
  }

  // ── Attach the new profile to the existing member row. The 183
  // partial unique index would reject this with 23505 if the same
  // (tenant, profile) was already attached to a different member;
  // surface that as 409 so the UI can suggest merging.
  const { error: linkErr } = await admin
    .from('members')
    .update({
      profile_id: userId,
      email,
      source: 'profile',
      updated_by: gate.userId,
    })
    .eq('id', memberId)
    .eq('tenant_id', gate.tenantId)

  if (linkErr) {
    if ((linkErr as { code?: string }).code === '23505') {
      return NextResponse.json({
        error: 'PROFILE_ALREADY_LINKED',
        message: 'Another member row in this tenant is already linked to this login. Merge the members first.',
      }, { status: 409 })
    }
    return sanitizeError(linkErr, 'admin/members/grant-login member link')
  }

  // Audit insert is best-effort but failures must be visible — a
  // silently-missing login_granted event would compromise the audit
  // trail. We surface as 500 only after the link has already happened,
  // so the caller sees "the access was granted but the audit row
  // failed to write" rather than swallowing it.
  const { error: eventErr } = await admin.from('member_status_events').insert({
    tenant_id:     gate.tenantId,
    member_id:     memberId,
    event_type:    'login_granted',
    actor_user_id: gate.userId,
    reason:        'admin granted app access via members page',
    new_values:    { profile_id: userId, email },
  })
  if (eventErr) {
    return sanitizeError(eventErr, 'admin/members/grant-login event insert')
  }

  const loginUrl = computeLoginUrl(req)
  const emailSent = await sendInviteEmail({
    to:           email,
    fullName,
    tempPassword: tempPassword ?? '',
    loginUrl,
    tenantName:   (tenantData as { name: string }).name,
  })

  return NextResponse.json({
    memberId,
    profileId: userId,
    tempPassword,
    emailSent,
  })
}
