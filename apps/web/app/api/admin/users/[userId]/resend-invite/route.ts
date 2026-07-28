import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { issueAndSendInvite } from '@/lib/invites/provision'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/admin/users/[userId]/resend-invite  { sendEmail?: boolean }
//
// The tenant-admin counterpart to the superadmin resend route. Answers the
// two things an admin needs when the invite email lands in a junk folder:
//
//   sendEmail: true  (default) → mail a fresh invite link, again
//   sendEmail: false           → mint the link and hand it back WITHOUT
//                                sending, so the admin can paste it into
//                                their own email, Teams, or a text message
//
// Both paths mint a NEW single-use token, which supersedes the invitee's
// previous link (see lib/invites/tokens). That is the honest behaviour —
// "resend" must not leave two live links floating around — but it does mean
// each click invalidates whatever was shared before it, so the UI says so.
//
// No password rotation. The superadmin route rotates the temp password
// because it predates the link flow; here the link is the credential, and
// rotating would brick a copy-paste fallback the admin may have already
// shared. /api/invites/refresh made the same call for the same reason.
//
// Audit trail: every issue writes an invite_tokens row stamped with
// created_by + created_at, so who re-shared which link, and when, is already
// recorded without a separate event.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Best-effort guardrail, not a security boundary (per-instance memory).
// Enough to stop a double-click or a stuck retry loop from spamming the
// recipient and thrashing the one link that is supposed to work.
const RESEND_LIMIT  = 6
const RESEND_WINDOW = 10 * 60_000

interface RouteContext { params: Promise<{ userId: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const { userId } = await ctx.params
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
  }

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  // Body is optional — a bare POST means "email it again".
  const body = await req.json().catch(() => ({})) as { sendEmail?: unknown }
  const sendEmail = body.sendEmail !== false

  const limit = checkMemoryRateLimit(`invite-resend:${gate.tenantId}:${userId}`, RESEND_LIMIT, RESEND_WINDOW)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many invites for this person just now. Try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec ?? 60) } },
    )
  }

  const admin = supabaseAdmin()

  // Scope the target to the caller's active tenant. Without this an admin of
  // any tenant could mint a working invite link for an arbitrary user id.
  const { data: membership, error: membershipErr } = await admin
    .from('tenant_memberships')
    .select('user_id, invite_cancelled_at')
    .eq('tenant_id', gate.tenantId)
    .eq('user_id', userId)
    .maybeSingle()
  if (membershipErr) return sanitizeError(membershipErr, 'admin/users/resend-invite membership lookup')
  if (!membership) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

  const { data: authData } = await admin.auth.admin.getUserById(userId)
  const authUser = authData?.user ?? null
  // Someone who has signed in owns a password we must not disturb: an invite
  // link sets a password, so re-issuing one to a live account is a takeover
  // primitive, not a courtesy. Password reset is their path.
  if (authUser?.last_sign_in_at) {
    return NextResponse.json({
      error: 'This person has already signed in. Send them to "Forgot password" instead of a new invite.',
    }, { status: 409 })
  }
  const email = authUser?.email ?? null
  if (!email) return NextResponse.json({ error: 'User has no email on file' }, { status: 404 })

  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name')
    .eq('id', gate.tenantId)
    .maybeSingle()
  if (tenantErr) return sanitizeError(tenantErr, 'admin/users/resend-invite tenant lookup')
  if (!tenant) return NextResponse.json({ error: 'Active tenant not found' }, { status: 404 })

  // Reactivate and restart the reminder clock. Migration 190 designed
  // soft-cancel to be reversible by clearing invite_cancelled_at, and this is
  // that path — without it a resend for a cron-cancelled invite would hand
  // out a link that dead-ends at "cancelled" on the accept page. Anchoring
  // invite_last_reminder_at to now (rather than nulling it) keeps the cron a
  // full week away instead of firing the morning after the resend.
  const { error: reactivateErr } = await admin
    .from('tenant_memberships')
    .update({
      invite_cancelled_at:     null,
      invite_cancelled_reason: null,
      invite_reminders_sent:   0,
      invite_last_reminder_at: new Date().toISOString(),
    })
    .eq('tenant_id', gate.tenantId)
    .eq('user_id', userId)
  if (reactivateErr) return sanitizeError(reactivateErr, 'admin/users/resend-invite reactivate')

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle()
  const fullName = (profile as { full_name: string | null } | null)?.full_name ?? ''

  const { inviteUrl, expiresAt, emailSent } = await issueAndSendInvite(admin, {
    userId,
    email,
    fullName,
    tenantId:   gate.tenantId,
    tenantName: (tenant as { name: string }).name,
    createdBy:  gate.userId,
    req,
    emailMode:  sendEmail ? 'invite_link' : 'link_only',
  })

  // issueAndSendInvite fails soft when the token can't be minted, and a
  // resend with no link is not a success worth reporting as one.
  if (!inviteUrl) {
    return NextResponse.json({ error: 'Could not issue an invite link. Try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, email, fullName, inviteUrl, expiresAt, emailSent })
}
