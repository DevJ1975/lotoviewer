// Shared invite provisioning. One implementation of the flow that was
// previously triplicated across /api/admin/users, /api/superadmin/
// tenants/[number]/members, and /api/admin/members/[memberId]/grant-login
// (the TODO(phase-2) extraction — the Rule of Three tripped).
//
// Three composable steps rather than one mega-function, because the
// routes legitimately differ in conflict handling, rollback, and
// members-roster work:
//   ensureInvitedUser      — auth.users + profiles (create or reuse)
//   ensureTenantMembership — tenant_memberships insert w/ conflict policy
//   issueAndSendInvite     — invite token + email (or "added" notice)
//
// Server-only: uses the service-role client and node:crypto (via tokens).

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { sendInviteEmail, computeLoginUrl } from '@/lib/email/sendInvite'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { generateTempPassword } from '@/lib/supabaseAdmin'
import { buildInviteUrl, inviteLinkTtlDays, issueInviteToken } from '@/lib/invites/tokens'
import type { TenantRole } from '@soteria/core/types'

interface ProfileRow {
  id:                    string
  email:                 string | null
  full_name:             string | null
  must_change_password?: boolean | null
}

export type ProvisionFailure = { ok: false; status: number; error: string; stage: string }

// 5xx detail is operator-only (Sentry via sanitizeError); 4xx messages
// were chosen by the provisioning code and are safe to show the admin.
export function provisionFailureResponse(failure: ProvisionFailure, route: string): NextResponse {
  if (failure.status >= 500) return sanitizeError(new Error(failure.error), `${route} ${failure.stage}`)
  return NextResponse.json({ error: failure.error }, { status: failure.status })
}

export interface EnsureInvitedUserResult {
  ok:              true
  userId:          string
  /** A profiles row existed for this email before the call. */
  alreadyExisted:  boolean
  /** We created the auth.users row — the caller may roll back via deleteUser. */
  createdAuthUser: boolean
  /** Only set when createdAuthUser — the admin's copy-paste fallback. */
  tempPassword?:   string
  fullName:        string
  /** True when this person still needs to finish first-time setup. */
  mustChangePassword: boolean
}

function profileNameFromAuthUser(user: User): string | null {
  const value = user.user_metadata?.full_name
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// Indexed lookup via migration 248 — replaces the old listUsers pagination
// (an O(n) scan that broke down past 10k users).
async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ user: User | null; error: { message: string } | null }> {
  const { data: userId, error: rpcErr } = await admin.rpc('auth_user_id_by_email', { p_email: email })
  if (rpcErr) return { user: null, error: rpcErr }
  if (!userId) return { user: null, error: null }

  const { data, error } = await admin.auth.admin.getUserById(userId as string)
  if (error) return { user: null, error }
  return { user: data?.user ?? null, error: null }
}

async function ensureProfileForExistingAuthUser(
  admin: SupabaseClient,
  user: User,
  email: string,
  fullName: string,
): Promise<{ ok: true; fullName: string; mustChangePassword: boolean } | { ok: false; error: { message: string } }> {
  // A stale auth user that never signed in has no password the invitee
  // knows (the original temp password was never delivered), so they still
  // need an invite LINK — not a "sign in with your existing account"
  // notice. Only a genuinely-active account skips the link.
  const mustChangePassword = !user.last_sign_in_at
  const { data: profile, error: lookupErr } = await admin
    .from('profiles')
    .select('id, email, full_name, must_change_password')
    .eq('id', user.id)
    .maybeSingle()
  if (lookupErr) return { ok: false, error: lookupErr }

  const existing = profile as ProfileRow | null
  if (existing) {
    const patch: Partial<Pick<ProfileRow, 'email' | 'full_name'>> & { updated_at?: string } = {}
    if ((existing.email ?? '').toLowerCase() !== email) patch.email = email
    if (fullName && !existing.full_name) patch.full_name = fullName

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      const { error } = await admin.from('profiles').update(patch).eq('id', user.id)
      if (error) return { ok: false, error }
    }
    return {
      ok: true,
      fullName: fullName || existing.full_name || '',
      mustChangePassword: existing.must_change_password === true || mustChangePassword,
    }
  }

  const insertedName = fullName || profileNameFromAuthUser(user)
  const { error: insertErr } = await admin.from('profiles').insert({
    id:                   user.id,
    email,
    full_name:            insertedName,
    must_change_password: mustChangePassword,
  })
  if (insertErr && (insertErr as { code?: string }).code !== '23505') {
    return { ok: false, error: insertErr }
  }
  return { ok: true, fullName: insertedName ?? '', mustChangePassword }
}

/**
 * Create or reuse the auth.users + profiles pair for an invitee.
 * `email` must already be normalized (lib/validation/tenants normalizeEmail).
 */
export async function ensureInvitedUser(
  admin: SupabaseClient,
  args: { email: string; fullName: string },
): Promise<EnsureInvitedUserResult | ProvisionFailure> {
  const { email, fullName } = args

  const { data: existingProfile, error: profileLookupErr } = await admin
    .from('profiles')
    .select('id, email, full_name, must_change_password')
    .eq('email', email)
    .maybeSingle()
  if (profileLookupErr) {
    return { ok: false, status: 500, error: profileLookupErr.message, stage: 'profile-lookup' }
  }

  if (existingProfile) {
    const profile = existingProfile as ProfileRow
    let resolvedName = fullName || profile.full_name || ''
    // Patch the name only when the caller supplied one and it's currently
    // empty — never clobber a user-edited name.
    if (fullName && !profile.full_name) {
      const { error } = await admin
        .from('profiles')
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq('id', profile.id)
      if (error) return { ok: false, status: 500, error: error.message, stage: 'profile-name-patch' }
      resolvedName = fullName
    }
    return {
      ok:                 true,
      userId:             profile.id,
      alreadyExisted:     true,
      createdAuthUser:    false,
      fullName:           resolvedName,
      mustChangePassword: profile.must_change_password === true,
    }
  }

  // No profile — create the auth user. The temp password is never emailed;
  // it is returned to the admin UI as the manual copy-paste fallback, and
  // rotation is forced on first login via must_change_password.
  const tempPassword = generateTempPassword()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  })

  if (createErr || !created?.user) {
    // Stale auth.users row with no profiles row: reuse and repair it.
    const { user: staleUser, error: lookupErr } = await findAuthUserByEmail(admin, email)
    if (lookupErr) return { ok: false, status: 500, error: lookupErr.message, stage: 'auth-lookup' }
    if (!staleUser) {
      return {
        ok:     false,
        status: 400,
        error:  createErr?.message ?? 'Could not create user',
        stage:  'auth-create',
      }
    }

    const repaired = await ensureProfileForExistingAuthUser(admin, staleUser, email, fullName)
    if (!repaired.ok) {
      return { ok: false, status: 500, error: repaired.error.message, stage: 'profile-repair' }
    }
    return {
      ok:                 true,
      userId:             staleUser.id,
      alreadyExisted:     true,
      createdAuthUser:    false,
      fullName:           repaired.fullName,
      mustChangePassword: repaired.mustChangePassword,
    }
  }

  const userId = created.user.id
  // handle_new_user (migration 003) auto-created the profiles row; patch it.
  const { error: patchErr } = await admin
    .from('profiles')
    .update({
      full_name:            fullName || null,
      must_change_password: true,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', userId)
  if (patchErr) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, status: 500, error: patchErr.message, stage: 'profile-patch' }
  }

  return {
    ok:                 true,
    userId,
    alreadyExisted:     false,
    createdAuthUser:    true,
    tempPassword,
    fullName,
    mustChangePassword: true,
  }
}

export async function ensureTenantMembership(
  admin: SupabaseClient,
  args: {
    userId:     string
    tenantId:   string
    role:       TenantRole
    invitedBy:  string
    /** 'error' → 409 on duplicate; 'ignore' → treat duplicate as success. */
    onConflict: 'error' | 'ignore'
  },
): Promise<{ ok: true; conflicted: boolean } | ProvisionFailure> {
  const { error } = await admin
    .from('tenant_memberships')
    .insert({
      user_id:    args.userId,
      tenant_id:  args.tenantId,
      role:       args.role,
      invited_by: args.invitedBy,
    })
  if (!error) return { ok: true, conflicted: false }

  if ((error as { code?: string }).code === '23505') {
    if (args.onConflict === 'ignore') return { ok: true, conflicted: true }
    return { ok: false, status: 409, error: 'already a member of this tenant', stage: 'membership-insert' }
  }
  return { ok: false, status: 500, error: error.message, stage: 'membership-insert' }
}

export interface IssueAndSendInviteArgs {
  userId:     string
  email:      string
  fullName:   string
  tenantId:   string
  tenantName?: string
  /** Inviting admin's user id (token audit + email_log). */
  createdBy:  string
  req:        Request
  /**
   * invite_link        → mint a token and send the "accept your invitation"
   *                      email (new users + stale never-signed-in invitees).
   * added_notification → the existing "you've been added to <tenant>" email
   *                      for genuinely active users (no link, no secrets).
   * link_only          → mint a token and send NOTHING. The admin shares the
   *                      returned URL themselves (the escape hatch for when
   *                      our mail keeps landing in the recipient's junk).
   */
  emailMode:  'invite_link' | 'added_notification' | 'link_only'
}

/**
 * Put the membership's invite bookkeeping back to "freshly invited".
 *
 * An admin issuing access is starting the invite lifecycle over, so every
 * counter the cron reads has to start over with it:
 *
 * - `invite_cancelled_at` blocks /api/invites/{validate,accept,refresh}.
 *   Without clearing it an admin could grant access, mint a valid token,
 *   email it, and the invitee would still hit "this invitation was
 *   cancelled" with no way out.
 * - `invite_reminders_sent` left at the maximum makes the next cron run
 *   cancel the invite we just issued instead of reminding about it.
 * - `invite_last_reminder_at` anchors the cadence in planInviteAction.
 *   Clearing it hands the anchor to the new invite's own timestamp, which
 *   is the honest clock for a lifecycle that just restarted.
 *
 * Runs on every admin-initiated send, not only on cancelled memberships:
 * an access reset for someone mid-cadence is a new invite, not a nudge
 * about the old one. The reminder cron mints its tokens through
 * issueInviteToken directly, so its own sends never land here — otherwise
 * this would reset the counter it is trying to advance.
 *
 * Best-effort: the invite itself is already valid, and failing the whole
 * request here would strand the caller worse than stale bookkeeping.
 */
async function restartInviteLifecycle(
  admin: SupabaseClient,
  args: { userId: string; tenantId: string },
): Promise<void> {
  const { error } = await admin
    .from('tenant_memberships')
    .update({
      invite_cancelled_at:     null,
      invite_cancelled_reason: null,
      invite_reminders_sent:   0,
      invite_last_reminder_at: null,
    })
    .eq('user_id', args.userId)
    .eq('tenant_id', args.tenantId)

  if (error) {
    Sentry.captureException(error, {
      tags: { module: 'issueAndSendInvite', stage: 'restart-invite-lifecycle' },
    })
  }
}

export async function issueAndSendInvite(
  admin: SupabaseClient,
  args: IssueAndSendInviteArgs,
): Promise<{ inviteUrl?: string; expiresAt?: string; emailSent: boolean }> {
  const appUrl = computeLoginUrl(args.req)

  // Runs for both modes: an admin re-adding someone should restart the
  // cadence whether or not this particular send carries a link.
  await restartInviteLifecycle(admin, { userId: args.userId, tenantId: args.tenantId })

  if (args.emailMode === 'added_notification') {
    const emailSent = await sendInviteEmail({
      to:         args.email,
      fullName:   args.fullName,
      inviteUrl:  '',
      loginUrl:   appUrl,
      tenantName: args.tenantName,
    })
    return { emailSent }
  }

  const issued = await issueInviteToken(admin, {
    userId:    args.userId,
    tenantId:  args.tenantId,
    email:     args.email,
    createdBy: args.createdBy,
  })
  if (!issued.ok) {
    // No token → nothing actionable to email. Fail soft: the admin UI's
    // existing emailSent===false fallback shows the temp password.
    Sentry.captureException(new Error(issued.error.message), {
      tags: { module: 'issueAndSendInvite', stage: 'token-issue' },
    })
    return { emailSent: false }
  }

  const inviteUrl = buildInviteUrl(appUrl, issued.raw)
  if (args.emailMode === 'link_only') {
    return { inviteUrl, expiresAt: issued.expiresAt, emailSent: false }
  }

  const emailSent = await sendInviteEmail({
    to:            args.email,
    fullName:      args.fullName,
    inviteUrl,
    loginUrl:      appUrl,
    tenantName:    args.tenantName,
    expiresInDays: inviteLinkTtlDays(),
  })
  return { inviteUrl, expiresAt: issued.expiresAt, emailSent }
}
