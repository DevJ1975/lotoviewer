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
