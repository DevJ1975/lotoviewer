import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'
import {
  buildInviteUrl,
  consumeInviteToken,
  hashInviteToken,
  inviteLinkTtlDays,
  issueInviteToken,
  type InviteTokenRow,
} from '@/lib/invites/tokens'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { clientIp } from '@/lib/rateLimit/clientIp'

// POST /api/invites/refresh  { token }
//
// "This link has expired — email me a fresh one." Possession of ANY
// previously-issued token (expired or superseded included) is the proof
// of identity: the recipient had access to the invite email, so we can
// re-email the same address without opening an email-enumeration
// surface. Never rotates the temp password — that would brick the
// admin's copy-paste fallback for in-flight invites.
//
// The PRESENTED token is consumed once a fresh one is issued, so a single
// leaked link can't be replayed to spam the address or thrash the
// invitee's live link. Aggressively rate-limited on top of that because
// it sends email.

export async function POST(req: Request) {
  const ip = clientIp(req)
  const limit = checkMemoryRateLimit(`invite-refresh:${ip}`, 5, 15 * 60_000)
  if (!limit.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: { token?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const token = typeof body.token === 'string' ? body.token : ''
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const admin = supabaseAdmin()
  const { data } = await admin
    .from('invite_tokens')
    .select('id, user_id, tenant_id, email, expires_at, used_at, superseded_at')
    .eq('token_hash', hashInviteToken(token))
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const row = data as InviteTokenRow

  if (row.used_at) return NextResponse.json({ status: 'already_active' })

  const { data: authUser } = await admin.auth.admin.getUserById(row.user_id)
  if (authUser?.user?.last_sign_in_at) {
    return NextResponse.json({ status: 'already_active' })
  }

  if (row.tenant_id) {
    const { data: membership } = await admin
      .from('tenant_memberships')
      .select('invite_cancelled_at')
      .eq('user_id', row.user_id)
      .eq('tenant_id', row.tenant_id)
      .maybeSingle()
    if (membership?.invite_cancelled_at) {
      return NextResponse.json({ status: 'cancelled' })
    }
  }

  const issued = await issueInviteToken(admin, {
    userId:    row.user_id,
    tenantId:  row.tenant_id,
    email:     row.email,
    createdBy: null,
  })
  if (!issued.ok) {
    Sentry.captureException(new Error(issued.error.message), {
      tags: { route: '/api/invites/refresh', stage: 'token-issue' },
    })
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', row.user_id)
    .maybeSingle()

  let tenantName: string | undefined
  if (row.tenant_id) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('name')
      .eq('id', row.tenant_id)
      .maybeSingle()
    tenantName = (tenant as { name: string } | null)?.name ?? undefined
  }

  const appUrl = computeLoginUrl(req)
  const emailSent = await sendInviteEmail({
    to:            row.email,
    fullName:      (profile as { full_name: string | null } | null)?.full_name ?? '',
    inviteUrl:     buildInviteUrl(appUrl, issued.raw),
    loginUrl:      appUrl,
    tenantName,
    expiresInDays: inviteLinkTtlDays(),
  })

  // Burn the presented token only once its replacement has actually reached
  // the invitee, so a leaked link can't be replayed to thrash the new one.
  //
  // Burning it first — as this did — turned any Resend failure into a dead
  // end: the replacement's raw token is never returned to the client (by
  // design; it belongs in the invitee's inbox, not in an HTTP response), so
  // a failed send left NOBODY holding a usable link, and the spent token
  // then reported 'used', which the UI renders as "your account is already
  // set up". Leaving it unburned costs nothing — issueInviteToken above has
  // already superseded it, so it can no longer be accepted; it can only be
  // re-presented here to try the send again.
  if (emailSent) await consumeInviteToken(admin, row.id)

  return NextResponse.json({ ok: true, emailSent })
}
