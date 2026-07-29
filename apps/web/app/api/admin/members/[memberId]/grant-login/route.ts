import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { inviteIssueRateLimit } from '@/lib/rateLimit/inviteIssue'
import {
  ensureInvitedUser,
  ensureTenantMembership,
  issueAndSendInvite,
  provisionFailureResponse,
} from '@/lib/invites/provision'
import { inviteLinkTtlDays } from '@/lib/invites/tokens'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { normalizeEmail } from '@/lib/validation/tenants'

// POST /api/admin/members/[memberId]/grant-login
//
// Grants app login access to an existing members row that doesn't yet
// have a profile_id. The auth+profile+membership provisioning is the
// shared lib/invites/provision helper (also used by /api/admin/users
// and the superadmin members route); this route additionally UPDATES
// the existing members row instead of inserting a fresh one — that's
// the whole point of the unified roster.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type TenantRole = 'owner' | 'admin' | 'member' | 'viewer'

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

  let body: { email?: unknown; fullName?: unknown }
  try { body = await req.json().catch(() => ({})) }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = supabaseAdmin()

  const { data: memberData, error: memberErr } = await admin
    .from('members')
    .select('id, tenant_id, profile_id, email, legal_name, display_name')
    .eq('id', memberId)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (memberErr) return sanitizeError(memberErr, 'admin/members/grant-login member lookup')
  if (!memberData) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const member = memberData as MemberRow
  if (member.profile_id) {
    return NextResponse.json({
      error: 'ALREADY_HAS_LOGIN',
      message: 'This member is already linked to a login account.',
    }, { status: 409 })
  }

  const overrideEmail = typeof body.email === 'string' ? body.email : ''
  const overrideName  = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const email = normalizeEmail(overrideEmail || member.email || '')
  if (!email) {
    return NextResponse.json({
      error: 'EMAIL_REQUIRED',
      message: 'This member has no email on file. Pass an email in the request body.',
    }, { status: 400 })
  }
  const fullName = overrideName || member.legal_name?.trim() || member.display_name || ''

  // Tenant context for the email subject line.
  const { data: tenantData, error: tenantErr } = await admin
    .from('tenants')
    .select('id, name')
    .eq('id', gate.tenantId)
    .maybeSingle()
  if (tenantErr) return sanitizeError(tenantErr, 'admin/members/grant-login tenant lookup')
  if (!tenantData) return NextResponse.json({ error: 'Active tenant not found' }, { status: 404 })

  // ── auth.users + profiles: reuse if email already exists, else create.
  const invited = await ensureInvitedUser(admin, { email, fullName })
  if (!invited.ok) return provisionFailureResponse(invited, 'admin/members/grant-login')
  const { userId, tempPassword } = invited

  // ── tenant_memberships: idempotent (a 23505 here just means the
  // user was already a member of this tenant under a different members
  // row — that's the merge candidate the admin probably wants).
  const role: TenantRole = 'member'
  const membership = await ensureTenantMembership(admin, {
    userId, tenantId: gate.tenantId, role, invitedBy: gate.userId, onConflict: 'ignore',
  })
  if (!membership.ok) return provisionFailureResponse(membership, 'admin/members/grant-login')

  // ── Attach the new profile to the existing member row. The 183
  // partial unique index would reject this with 23505 if the same
  // (tenant, profile) was already attached to a different member;
  // surface that as 409 so the UI can suggest merging.
  const { error: linkErr } = await admin
    .from('members')
    .update({
      profile_id: userId,
      email,
      source: 'profile',
      updated_by: gate.userId,
    })
    .eq('id', memberId)
    .eq('tenant_id', gate.tenantId)

  if (linkErr) {
    if ((linkErr as { code?: string }).code === '23505') {
      return NextResponse.json({
        error: 'PROFILE_ALREADY_LINKED',
        message: 'Another member row in this tenant is already linked to this login. Merge the members first.',
      }, { status: 409 })
    }
    return sanitizeError(linkErr, 'admin/members/grant-login member link')
  }

  // Audit insert is best-effort but failures must be visible — a
  // silently-missing login_granted event would compromise the audit
  // trail. We surface as 500 only after the link has already happened,
  // so the caller sees "the access was granted but the audit row
  // failed to write" rather than swallowing it.
  const { error: eventErr } = await admin.from('member_status_events').insert({
    tenant_id:     gate.tenantId,
    member_id:     memberId,
    event_type:    'login_granted',
    actor_user_id: gate.userId,
    reason:        'admin granted app access via members page',
    new_values:    { profile_id: userId, email },
  })
  if (eventErr) {
    return sanitizeError(eventErr, 'admin/members/grant-login event insert')
  }

  const { inviteUrl, emailSent } = await issueAndSendInvite(admin, {
    userId,
    email,
    fullName:   invited.fullName || fullName,
    tenantId:   gate.tenantId,
    tenantName: (tenantData as { name: string }).name,
    createdBy:  gate.userId,
    req,
    emailMode:  invited.createdAuthUser || invited.mustChangePassword ? 'invite_link' : 'added_notification',
  })

  return NextResponse.json({
    memberId,
    profileId: userId,
    email,
    tempPassword,
    inviteUrl,
    emailSent,
    expiresInDays: inviteLinkTtlDays(),
    tenantName: (tenantData as { name: string }).name,
  })
}
