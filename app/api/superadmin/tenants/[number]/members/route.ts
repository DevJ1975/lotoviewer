import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'
import type { TenantRole } from '@/lib/types'

// POST /api/superadmin/tenants/[number]/members
//
// Adds a user to a tenant. If the email already maps to a profiles row,
// just creates the tenant_memberships link. If not, creates auth.users +
// profile (must_change_password = true) and returns a temp password for
// superadmin to share — Resend integration optional and not wired here.
//
// Body:
//   { email: string,
//     role:  'owner' | 'admin' | 'member' | 'viewer',
//     full_name?: string }
//
// Response:
//   201 → { user_id, email, role, tempPassword?: string, alreadyExisted: boolean }
//   400/404/409 with { error }

const VALID_ROLES: ReadonlySet<TenantRole> =
  new Set<TenantRole>(['owner', 'admin', 'member', 'viewer'])

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!/^[0-9]{4}$/.test(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  let body: { email?: unknown; role?: unknown; full_name?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const role = body.role as TenantRole
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''

  const admin = supabaseAdmin()

  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .select('id, tenant_number')
    .eq('tenant_number', number)
    .maybeSingle()
  if (tErr) {
    Sentry.captureException(tErr)
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
    Sentry.captureException(insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    user_id: userId,
    email,
    role,
    tempPassword,
    alreadyExisted,
  }, { status: 201 })
}
