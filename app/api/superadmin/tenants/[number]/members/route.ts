import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'
import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'
import { isValidRole, isValidTenantNumber, normalizeEmail } from '@/lib/validation/tenants'
import type { TenantRole } from '@/lib/types'

// GET  /api/superadmin/tenants/[number]/members
// POST /api/superadmin/tenants/[number]/members
//
// GET returns enriched member data: membership row + profile + auth.users
// fields (last_sign_in_at, must_change_password) so the UI can show
// invite status (Invited / Pending / Active) and timestamps.
//
// POST adds a user to a tenant. If the email already maps to a profiles
// row, just creates the tenant_memberships link. If not, creates auth.users
// + profile (must_change_password = true), generates a one-time password,
// and emails the invite via Resend (lib/email/sendInvite). The temp
// password is also returned in the response so the superadmin has a
// copy-paste fallback when Resend isn't configured.

// ─── GET ───────────────────────────────────────────────────────────────────

export interface EnrichedMember {
  user_id:              string
  role:                 TenantRole
  joined_at:            string  // tenant_memberships.created_at
  email:                string | null
  full_name:            string | null
  is_admin:             boolean
  is_superadmin:        boolean
  must_change_password: boolean
  last_sign_in_at:      string | null
  // Computed: 'invited' (never logged in) | 'active' (has signed in)
  status:               'invited' | 'active'
}

export async function GET(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .select('id, tenant_number')
    .eq('tenant_number', number)
    .maybeSingle()
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const { data: rows, error: mErr } = await admin
    .from('tenant_memberships')
    .select('user_id, role, created_at, profiles:user_id(email, full_name, is_admin, is_superadmin, must_change_password)')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: true })
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  type RawProfile = {
    email: string | null; full_name: string | null
    is_admin: boolean | null; is_superadmin: boolean | null
    must_change_password: boolean | null
  }
  type RawRow = {
    user_id: string; role: TenantRole; created_at: string
    profiles: RawProfile | RawProfile[] | null
  }

  // Enrich with auth.users data — last_sign_in_at — via the admin auth API.
  // Pages through listUsers in 200-row batches so tenants with > 200
  // members don't lose status enrichment for the rest. Hard cap at 50
  // pages (10k users) to bound the worst case.
  const lastSignInByUserId = new Map<string, string | null>()
  const PAGE_SIZE = 200
  const MAX_PAGES = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data: authData, error: aErr } =
      await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
    const users = authData?.users ?? []
    for (const u of users) lastSignInByUserId.set(u.id, u.last_sign_in_at ?? null)
    if (users.length < PAGE_SIZE) break  // last page
  }

  const enriched: EnrichedMember[] = ((rows ?? []) as unknown as RawRow[]).map(r => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] ?? null : r.profiles
    const lastSignInAt = lastSignInByUserId.get(r.user_id) ?? null
    return {
      user_id:              r.user_id,
      role:                 r.role,
      joined_at:            r.created_at,
      email:                p?.email ?? null,
      full_name:            p?.full_name ?? null,
      is_admin:             p?.is_admin === true,
      is_superadmin:        p?.is_superadmin === true,
      must_change_password: p?.must_change_password === true,
      last_sign_in_at:      lastSignInAt,
      status:               lastSignInAt ? 'active' : 'invited',
    }
  })

  return NextResponse.json({ members: enriched })
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  let body: { email?: unknown; role?: unknown; full_name?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = normalizeEmail(body.email)
  if (!email) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  if (!isValidRole(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  const role = body.role as TenantRole

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''

  const admin = supabaseAdmin()

  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .select('id, tenant_number, name')
    .eq('tenant_number', number)
    .maybeSingle()
  if (tErr) {
    Sentry.captureException(tErr, { tags: { route: '/api/superadmin/tenants/[number]/members', stage: 'tenant-lookup' } })
    return NextResponse.json({ error: tErr.message }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Find existing profile by email.
  const { data: existing } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .maybeSingle()

  let userId: string
  let tempPassword: string | undefined
  const alreadyExisted = !!existing

  if (existing) {
    userId = existing.id
  } else {
    // Create auth user + profile (handle_new_user trigger from migration 003
    // auto-creates the profiles row). Random temp password; rotation forced
    // on first login via must_change_password = true.
    tempPassword = generateTempPassword()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })
    if (createErr || !created.user) {
      return NextResponse.json({
        error: createErr?.message ?? 'Could not create user',
      }, { status: 400 })
    }
    userId = created.user.id

    // Patch the auto-created profiles row with full_name + must_change_password.
    await admin.from('profiles').update({
      full_name:            fullName || null,
      must_change_password: true,
    }).eq('id', userId)
  }

  // Insert membership. PK is (user_id, tenant_id) so re-invites collide.
  const { error: insertErr } = await admin
    .from('tenant_memberships')
    .insert({ user_id: userId, tenant_id: tenant.id, role, invited_by: gate.userId })

  if (insertErr) {
    const code = (insertErr as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({
        error: `${email} is already a member of this tenant`,
      }, { status: 409 })
    }
    Sentry.captureException(insertErr, { tags: { route: '/api/superadmin/tenants/[number]/members', stage: 'membership-insert' } })
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Send the invite email only for newly-created users — they need the
  // temp password. Existing users see the new tenant in their switcher
  // on next login; emailing them with a "tempPassword: " section that
  // doesn't apply would just confuse.
  let emailSent = false
  if (tempPassword) {
    const loginUrl = computeLoginUrl(req)
    emailSent = await sendInviteEmail({
      to:           email,
      fullName,
      tempPassword,
      loginUrl,
      tenantName:   tenant.name,
    })
  }

  return NextResponse.json({
    user_id: userId,
    email,
    role,
    tempPassword,
    emailSent,
    alreadyExisted,
  }, { status: 201 })
}
