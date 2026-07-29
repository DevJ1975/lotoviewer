import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { consumeInviteToken, verifyInviteToken } from '@/lib/invites/tokens'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { clientIp } from '@/lib/rateLimit/clientIp'
import { sanitizeError } from '@/lib/security/sanitizeError'

// POST /api/invites/accept  { token, fullName, password }
//
// The invite-link acceptance: sets the recipient's chosen password and
// name, clears must_change_password, and consumes the token. The client
// then signs in with supabase.auth.signInWithPassword as normal — which
// also stamps last_sign_in_at, flipping the computed invite status from
// 'invited' to 'active' with no extra bookkeeping.
//
// SECURITY — the token IS the credential, so this write path enforces the
// same gates the read paths (validate/refresh) do:
//   1. already-active guard: a still-valid token must NOT be able to set a
//      password on an account that has already signed in (e.g. a user who
//      logged in with the admin's copy-paste temp password and never
//      clicked the link). Without this, a leaked token is a password-reset
//      primitive against a live account.
//   2. atomic single-use: the token is CLAIMED (consumed) before the
//      password write, so two concurrent submits can't both rotate the
//      password (last-writer-wins). A rare post-claim failure is
//      recoverable via resend/grant-login, which mints a fresh token.

const MIN_PASSWORD_LENGTH = 8

export async function POST(req: Request) {
  const ip = clientIp(req)
  const limit = checkMemoryRateLimit(`invite-accept:${ip}`, 10, 60_000)
  if (!limit.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: { token?: unknown; fullName?: unknown; password?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const token    = typeof body.token === 'string' ? body.token : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!token) return NextResponse.json({ status: 'not_found' }, { status: 400 })
  if (!fullName) {
    return NextResponse.json({ error: 'Please enter your full name.' }, { status: 400 })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { status, row } = await verifyInviteToken(admin, token)
  if (status !== 'valid' || !row) return NextResponse.json({ status }, { status: 400 })

  if (row.tenant_id) {
    const { data: membership } = await admin
      .from('tenant_memberships')
      .select('invite_cancelled_at')
      .eq('user_id', row.user_id)
      .eq('tenant_id', row.tenant_id)
      .maybeSingle()
    if (membership?.invite_cancelled_at) {
      return NextResponse.json({ status: 'cancelled' }, { status: 400 })
    }
  }

  // Guard 1: never rotate the password of an account that has already
  // signed in. Mirrors validate/refresh; without it a live token is a
  // takeover primitive against an active user.
  const { data: authUser } = await admin.auth.admin.getUserById(row.user_id)
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json({ status: 'already_active' }, { status: 400 })
  }

  // Guard 2: claim the token atomically BEFORE the password write. A
  // second concurrent submit loses the claim (0 rows updated) and is
  // rejected, so the password can't be set twice from one token.
  const claimed = await consumeInviteToken(admin, row.id)
  if (!claimed) return NextResponse.json({ status: 'used' }, { status: 400 })

  const { error: pwErr } = await admin.auth.admin.updateUserById(row.user_id, { password })
  if (pwErr) return sanitizeError(pwErr, 'invites/accept password update')

  const { error: profileErr } = await admin
    .from('profiles')
    .update({
      full_name:            fullName,
      must_change_password: false,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', row.user_id)
  if (profileErr) return sanitizeError(profileErr, 'invites/accept profile update')

  return NextResponse.json({ ok: true, email: row.email })
}
