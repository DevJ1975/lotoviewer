import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { generateInviteLink } from '@/lib/auth/inviteLink'
import { sendVerifyInviteEmail } from '@/lib/email/sendVerifyInvite'
import { computeLoginUrl } from '@/lib/email/sendInvite'
import { isValidTenantNumber } from '@/lib/validation/tenants'

// POST /api/superadmin/tenants/[number]/members/[user_id]/resend-invite
//
// Re-issues a fresh verify-and-set-password link to a member who hasn't
// finished activating their account yet. Refuses for users who already chose
// their own password (the right action for them is the password-reset flow,
// not a re-invite). No secret is rotated — the link itself is the credential.
//
// Behavior:
//   1. Require superadmin (env allowlist + DB flag)
//   2. Look up the membership; 404 if missing
//   3. Look up the email + profile; if profiles.must_change_password is
//      false (setup already completed) → 409
//   4. Generate a fresh verification link (magic link for the existing user)
//   5. Re-assert profiles.must_change_password = true (in case it drifted)
//   6. Email the link via sendVerifyInviteEmail
//   7. Return { emailSent } so the UI can surface a resend failure

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

  const { data: authUser } = await admin.auth.admin.getUserById(user_id)
  const email = authUser?.user?.email ?? null
  if (!email) {
    // No email on file → either the auth.users row doesn't exist
    // anymore (race with a delete) or the row exists with a null email
    // (corrupted state). Either way it's not a server fault — return
    // 404 so the UI shows "user not found" rather than "server error."
    return NextResponse.json({ error: 'User has no email on file' }, { status: 404 })
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, must_change_password')
    .eq('id', user_id)
    .maybeSingle()

  // Refuse the resend if the user already finished setup (chose their own
  // password). must_change_password stays true until /welcome completes, so
  // it — not last_sign_in_at, which a verify-link click would set — is the
  // accurate "still onboarding" signal.
  if (profile?.must_change_password === false) {
    return NextResponse.json({
      error: 'User has already activated their account — use the password-reset flow instead of resending the invite.',
    }, { status: 409 })
  }

  const loginUrl = computeLoginUrl(req)
  const invite = await generateInviteLink(admin, {
    email,
    fullName:   profile?.full_name ?? undefined,
    redirectTo: `${loginUrl}/welcome`,
  })
  if (!invite.ok) {
    Sentry.captureException(invite.error, {
      tags: { route: '/api/superadmin/tenants/[number]/members/[user_id]/resend-invite', stage: 'generate-invite-link' },
    })
    return NextResponse.json({ error: invite.error.message }, { status: 500 })
  }

  // Re-assert the onboarding flag in case it drifted.
  await admin.from('profiles').update({ must_change_password: true }).eq('id', user_id)

  const emailSent = await sendVerifyInviteEmail({
    to:         email,
    fullName:   profile?.full_name ?? '',
    verifyUrl:  invite.result.actionLink,
    tenantName: tenant.name,
  })

  return NextResponse.json({ ok: true, email, emailSent })
}
