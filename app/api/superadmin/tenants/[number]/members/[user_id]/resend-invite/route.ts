import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'
import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'
import { isValidTenantNumber } from '@/lib/validation/tenants'

// POST /api/superadmin/tenants/[number]/members/[user_id]/resend-invite
//
// Re-issues a one-time password to a member who hasn't signed in yet
// and emails them a fresh invite. Refuses to resend for users that have
// already signed in (their existing password works; the right action
// for them is the password-reset flow on the auth provider, not a
// silent password rotation).
//
// Behavior:
//   1. Require superadmin (env allowlist + DB flag)
//   2. Look up the membership; 404 if missing
//   3. Look up auth.users; if last_sign_in_at is NOT null → 409
//   4. Generate a new temp password, patch auth.users.password
//   5. Patch profiles.must_change_password = true (in case it drifted)
//   6. Email the invite via sendInviteEmail
//   7. Return { tempPassword, emailSent } so the UI can fall back to
//      copy-paste when Resend isn't configured

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ number: string; user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number, user_id } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }
  if (!UUID_RE.test(user_id)) {
    return NextResponse.json({ error: 'Invalid user_id' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, tenant_number, name')
    .eq('tenant_number', number)
    .maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Confirm the user actually has a membership in this tenant.
  const { data: membership } = await admin
    .from('tenant_memberships')
    .select('user_id')
    .eq('tenant_id', tenant.id)
    .eq('user_id', user_id)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'No membership in this tenant' }, { status: 404 })
  }

  // Refuse the resend if they've already signed in — rotating their
  // password silently would lock them out.
  const { data: authUser } = await admin.auth.admin.getUserById(user_id)
  const lastSignInAt = authUser?.user?.last_sign_in_at ?? null
  const email = authUser?.user?.email ?? null
  if (lastSignInAt) {
    return NextResponse.json({
      error: 'User has already signed in — use the auth provider\'s password-reset flow instead of resending the invite.',
    }, { status: 409 })
  }
  if (!email) {
    // No email on file → either the auth.users row doesn't exist
    // anymore (race with a delete) or the row exists with a null email
    // (corrupted state). Either way it's not a server fault — return
    // 404 so the UI shows "user not found" rather than "server error."
    return NextResponse.json({ error: 'User has no email on file' }, { status: 404 })
  }

  // Rotate password + force change on next login.
  const tempPassword = generateTempPassword()
  const { error: updateAuthErr } = await admin.auth.admin.updateUserById(user_id, {
    password: tempPassword,
  })
  if (updateAuthErr) {
    Sentry.captureException(updateAuthErr, {
      tags: { route: '/api/superadmin/tenants/[number]/members/[user_id]/resend-invite', stage: 'rotate-password' },
    })
    return NextResponse.json({ error: updateAuthErr.message }, { status: 500 })
  }
  await admin.from('profiles').update({ must_change_password: true }).eq('id', user_id)

  // Look up display name for the email.
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', user_id)
    .maybeSingle()

  const loginUrl = computeLoginUrl(req)
  const emailSent = await sendInviteEmail({
    to:           email,
    fullName:     profile?.full_name ?? '',
    tempPassword,
    loginUrl,
    tenantName:   tenant.name,
  })

  return NextResponse.json({ ok: true, email, tempPassword, emailSent })
}
