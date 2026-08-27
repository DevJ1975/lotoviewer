import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { inviteIssueRateLimit } from '@/lib/rateLimit/inviteIssue'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'
import { issueAndSendInvite } from '@/lib/invites/provision'
import { isValidTenantNumber } from '@/lib/validation/tenants'

// POST /api/superadmin/tenants/[number]/members/[user_id]/resend-invite
//
// Re-issues a fresh single-use invite LINK (superseding any previous
// one) to a member who hasn't signed in yet, and rotates their one-time
// password so the admin's copy-paste fallback stays honest. Refuses to
// resend for users that have already signed in (their existing password
// works; the right action for them is the password-reset flow, not a
// silent password rotation).
//
// Behavior:
//   1. Require superadmin (env allowlist + DB flag)
//   2. Look up the membership; 404 if missing
//   3. Look up auth.users + the profile; 409 if EITHER last_sign_in_at is
//      set OR must_change_password is already false (see the guard below)
//   4. Generate a new temp password, patch auth.users.password
//   5. Patch profiles.must_change_password = true (in case it drifted)
//   6. Mint a fresh invite token + email the accept-invite link
//   7. Return { tempPassword, inviteUrl, emailSent } so the UI can fall
//      back to copy-paste when Resend isn't configured

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ number: string; user_id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limited = inviteIssueRateLimit(gate.userId)
  if (limited) return limited

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

  // Refuse the resend if they already hold a password of their own —
  // rotating it silently would lock them out.
  //
  // Two independent signals, because neither alone is sufficient:
  //
  //   last_sign_in_at   — they have completed a browser sign-in.
  //   must_change_password === false — they chose their own password.
  //
  // The second is the one that matters. /api/invites/accept sets the
  // password and clears the flag but does NOT establish a session — the
  // client signs in separately afterwards, and that is what stamps
  // last_sign_in_at. A user whose accept succeeded but whose follow-up
  // sign-in never landed (closed tab, dropped network) therefore has a
  // WORKING password and a null last_sign_in_at. The superadmin UI lists
  // them as "Invited", so resending at them is a likely mis-click, not an
  // exotic race — and on the old last_sign_in_at-only guard it silently
  // rotated a password they were still using.
  const { data: authUser } = await admin.auth.admin.getUserById(user_id)
  const lastSignInAt = authUser?.user?.last_sign_in_at ?? null
  const email = authUser?.user?.email ?? null

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, must_change_password')
    .eq('id', user_id)
    .maybeSingle()

  // Strict `=== false`: a null flag or a missing profile row means setup
  // never completed, which is exactly who a resend is for.
  const hasOwnPassword = profile?.must_change_password === false

  if (lastSignInAt || hasOwnPassword) {
    return NextResponse.json({
      error: 'User has already set their password — use the auth provider\'s password-reset flow instead of resending the invite.',
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
  // Safe to force unconditionally: the guard above established that the
  // flag is not already false, so this can only re-assert an existing
  // `true` or repair a null.
  await admin.from('profiles').update({ must_change_password: true }).eq('id', user_id)

  const { inviteUrl, emailSent } = await issueAndSendInvite(admin, {
    userId:     user_id,
    email,
    fullName:   profile?.full_name ?? '',
    tenantId:   tenant.id,
    tenantName: tenant.name,
    createdBy:  gate.userId,
    req,
    emailMode:  'invite_link',
  })

  return NextResponse.json({ ok: true, email, tempPassword, inviteUrl, emailSent })
}
