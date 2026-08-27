import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { issueAndSendInvite } from '@/lib/invites/provision'
import { inviteLinkTtlDays } from '@/lib/invites/tokens'
import { inviteIssueRateLimit } from '@/lib/rateLimit/inviteIssue'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'

// POST /api/admin/members/[memberId]/reset-access
//
// Re-issues access for a member who ALREADY has a login: mints a fresh
// single-use invite link (superseding any earlier one), rotates the
// one-time password, and forces a password change on next sign-in.
//
// How this differs from the superadmin resend-invite route: that one
// refuses (409) once `last_sign_in_at` is set, because a *resend* that
// silently rotated a working password would lock the person out. This
// route is the deliberate opposite — an admin choosing "reset access"
// is asking for exactly that rotation, for the worker who is locked out
// or whose phone walked off site. The destructive part is therefore the
// point, not an accident, and the UI confirms before calling it.
//
// Requires tenant admin (not superadmin): resetting a forklift
// operator's password at 6am is a site-lead task, and routing it
// through superadmin is why it wasn't getting done.
//
// The caller must also OUT-RANK the target. Authorizing the caller alone is
// not enough when the route rotates a credential and hands it back in the
// response body: that combination turns "reset a worker's access" into
// "mint myself a working login as anyone in this tenant", including the
// owner and any superadmin who happens to hold a membership here. Returning
// the password is deliberate — the copy-paste fallback is the whole point
// for a worker with no email on their phone — so the rank check is what
// bounds it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ memberId: string }> }

interface MemberRow {
  id:           string
  tenant_id:    string
  profile_id:   string | null
  email:        string | null
  legal_name:   string | null
  display_name: string
}

export async function POST(req: Request, ctx: RouteContext) {
  const { memberId } = await ctx.params
  if (!UUID_RE.test(memberId)) {
    return NextResponse.json({ error: 'Invalid member id' }, { status: 400 })
  }

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const limited = inviteIssueRateLimit(gate.userId)
  if (limited) return limited

  const admin = supabaseAdmin()

  const { data: memberData, error: memberErr } = await admin
    .from('members')
    .select('id, tenant_id, profile_id, email, legal_name, display_name')
    .eq('id', memberId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (memberErr) return sanitizeError(memberErr, 'admin/members/reset-access member lookup')
  if (!memberData) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const member = memberData as MemberRow
  if (!member.profile_id) {
    return NextResponse.json({
      error:   'NO_LOGIN',
      message: 'This member has no login yet. Use "Grant app access" instead.',
    }, { status: 409 })
  }

  const rankCheck = await assertOutranksTarget(admin, gate, member.profile_id)
  if (rankCheck) return rankCheck

  // auth.users is the authority on the sign-in address; members.email can
  // drift from it (a member row edited without re-provisioning). Reset the
  // credential that actually works, and tell the admin which address it is.
  const { data: authUser } = await admin.auth.admin.getUserById(member.profile_id)
  const email = authUser?.user?.email ?? member.email ?? ''
  if (!email) {
    return NextResponse.json({
      error:   'NO_EMAIL',
      message: 'This login has no email address on file, so no invite can be sent.',
    }, { status: 409 })
  }

  const tempPassword = generateTempPassword()
  const { error: rotateErr } = await admin.auth.admin.updateUserById(member.profile_id, {
    password: tempPassword,
  })
  if (rotateErr) {
    Sentry.captureException(rotateErr, {
      tags: { route: '/api/admin/members/[memberId]/reset-access', stage: 'rotate-password' },
    })
    return sanitizeError(rotateErr, 'admin/members/reset-access rotate password')
  }

  // Force the change-on-next-login prompt. Best-effort by design: the
  // password is already rotated, and failing the whole request here
  // would leave the admin believing nothing happened when it did.
  const { error: flagErr } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', member.profile_id)
  if (flagErr) {
    Sentry.captureException(flagErr, {
      tags: { route: '/api/admin/members/[memberId]/reset-access', stage: 'must-change-flag' },
    })
  }

  const { data: tenantData, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name')
    .eq('id', gate.tenantId)
    .maybeSingle()
  if (tenantErr) return sanitizeError(tenantErr, 'admin/members/reset-access tenant lookup')

  const tenantName = (tenantData as { name?: string } | null)?.name
  const fullName   = member.legal_name?.trim() || member.display_name || ''

  const { inviteUrl, emailSent } = await issueAndSendInvite(admin, {
    userId:     member.profile_id,
    email,
    fullName,
    tenantId:   gate.tenantId,
    tenantName,
    createdBy:  gate.userId,
    req,
    emailMode:  'invite_link',
  })

  // Credential rotation is exactly the event an auditor comes looking
  // for, so a failed audit write is surfaced rather than swallowed —
  // same contract as the grant-login route.
  const { error: eventErr } = await admin.from('member_status_events').insert({
    tenant_id:     gate.tenantId,
    member_id:     memberId,
    event_type:    'access_reset',
    actor_user_id: gate.userId,
    reason:        'admin reset app access via members page',
    new_values:    { email, emailSent },
  })
  if (eventErr) return sanitizeError(eventErr, 'admin/members/reset-access event insert')

  return NextResponse.json({
    memberId,
    email,
    tempPassword,
    inviteUrl,
    emailSent,
    expiresInDays: inviteLinkTtlDays(),
    tenantName,
  })
}

/** owner > admin > member/viewer. A target with no membership anywhere ranks 0. */
const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1, viewer: 1 }

/**
 * Refuse a reset whose target ranks at or above the caller.
 *
 * Strict dominance, not "is the caller an admin": two admins in one tenant
 * must not be able to take each other over, and no tenant role may reset a
 * superadmin. Self-reset is allowed explicitly — rotating your own password
 * is not an escalation, and strict dominance would otherwise forbid it.
 *
 * The target's rank is the HIGHEST role they hold in ANY tenant, because the
 * password being rotated is account-global. The cost is that a customer admin
 * can no longer reset someone who owns a tenant of their own; that person uses
 * the self-service reset on the sign-in page instead, which is the correct
 * trade — the alternative hands one tenant's admin a credential for another
 * tenant's owner.
 *
 * Returns a response to send, or null when the reset may proceed.
 */
async function assertOutranksTarget(
  admin: ReturnType<typeof supabaseAdmin>,
  gate: { userId: string; tenantId: string; role: string },
  targetUserId: string,
): Promise<NextResponse | null> {
  if (targetUserId === gate.userId) return null
  if (gate.role === 'superadmin') return null

  const { data: targetProfile, error: profileErr } = await admin
    .from('profiles')
    .select('is_superadmin')
    .eq('id', targetUserId)
    .maybeSingle()
  if (profileErr) return sanitizeError(profileErr, 'admin/members/reset-access target profile lookup')
  if ((targetProfile as { is_superadmin?: boolean } | null)?.is_superadmin) {
    return NextResponse.json({
      error:   'FORBIDDEN_TARGET',
      message: 'This login belongs to a Soteria administrator and cannot be reset from here.',
    }, { status: 403 })
  }

  // EVERY tenant, not just this one. The rank check has to be account-global
  // because the thing it guards is account-global: auth.users holds ONE
  // password, and `members` is per-tenant by design (migration 131:
  // `unique (tenant_id, profile_id)`), so one person legitimately holds member
  // rows in several tenants. Scoping this to gate.tenantId would let an admin
  // of tenant A reset someone who is a plain member of A but the OWNER of
  // tenant B — rotating the credential that owns B, and handing it back in
  // this route's response body.
  //
  // Deliberately UNFILTERED — no `invite_cancelled_at is null`, no
  // `tenants.disabled_at is null`, unlike tenantGate and migration 190's RLS
  // functions. They answer a different question. The gate asks "does this row
  // grant access right now", so it must honour revocation. This asks "what
  // could this credential become", and both revocation states are one-click
  // reversible: reactivateInvite() clears invite_cancelled_at on any re-issue,
  // and the superadmin tenant PATCH sets disabled_at back to null. Filtering
  // them would reopen the hole — let tenant B's invite lapse, have A's admin
  // reset the shared login and read tempPassword out of this response, then
  // reactivate B. The password outlives the revocation, so the rank must too.
  const { data: targetMemberships, error: membershipErr } = await admin
    .from('tenant_memberships')
    .select('role')
    .eq('user_id', targetUserId)
  if (membershipErr) return sanitizeError(membershipErr, 'admin/members/reset-access target membership lookup')

  const rows = (targetMemberships ?? []) as Array<{ role?: string }>
  const targetRank = rows.reduce((hi, r) => Math.max(hi, ROLE_RANK[r.role ?? ''] ?? 0), 0)
  const callerRank = ROLE_RANK[gate.role] ?? 0
  if (targetRank >= callerRank) {
    return NextResponse.json({
      error:   'FORBIDDEN_TARGET',
      message: 'You cannot reset access for someone at or above your own role, here or in another organization they belong to. They can reset their own password from the sign-in page.',
    }, { status: 403 })
  }

  return null
}
