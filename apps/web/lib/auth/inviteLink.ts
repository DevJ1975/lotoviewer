import type { SupabaseClient } from '@supabase/supabase-js'

// Generates a verification + set-password link for an invited user WITHOUT
// triggering Supabase's own email — we deliver it via Resend so the message
// is branded, logged, and deliverability-tuned (see lib/email/sendVerifyInvite).
//
// Clicking the link proves the recipient owns the mailbox: Supabase verifies
// the one-time token (setting auth.users.email_confirmed_at) and redirects to
// /welcome with a session in the URL hash, where the user sets their own
// password. This replaces the previous "createUser({ email_confirm: true }) +
// email a temp password" flow, which marked addresses confirmed without any
// proof of ownership — a typo'd address silently received a working account.
//
// Link type:
//   invite    — brand-new address; creates the unconfirmed auth user and
//               returns its id (the handle_new_user trigger backfills the
//               profiles row).
//   magiclink — fallback when the address is already registered (a re-invite,
//               or a stale signup with no profile). Works whether or not the
//               mailbox was previously confirmed, and the resulting session
//               still lets the user set a password on /welcome.
//
// Server-only: requires the service-role client (admin.auth.admin.*).

export interface InviteLinkResult {
  userId:     string
  actionLink: string
  // true  → a brand-new auth user was created (callers roll this back on a
  //         later failure); false → an existing/stale auth user was re-linked.
  created:    boolean
}

export interface InviteLinkArgs {
  email:      string
  fullName?:  string
  // Absolute URL the verify link redirects to after the token is consumed.
  // Must be registered in Supabase Auth → URL Configuration → Redirect URLs.
  redirectTo: string
}

type GenerateLinkOutcome =
  | { ok: true; result: InviteLinkResult }
  | { ok: false; error: { message: string } }

export async function generateInviteLink(
  admin: SupabaseClient,
  args: InviteLinkArgs,
): Promise<GenerateLinkOutcome> {
  const data = args.fullName ? { full_name: args.fullName } : undefined

  const invite = await admin.auth.admin.generateLink({
    type:    'invite',
    email:   args.email,
    options: { data, redirectTo: args.redirectTo },
  })
  const inviteLink = invite.data?.properties?.action_link
  if (!invite.error && inviteLink && invite.data?.user) {
    return { ok: true, result: { userId: invite.data.user.id, actionLink: inviteLink, created: true } }
  }

  // Already-registered (or stale) address → re-issue via magic link so the
  // user can still verify + set a password without us rotating any secret.
  const magic = await admin.auth.admin.generateLink({
    type:    'magiclink',
    email:   args.email,
    options: { data, redirectTo: args.redirectTo },
  })
  const magicLink = magic.data?.properties?.action_link
  if (!magic.error && magicLink && magic.data?.user) {
    return { ok: true, result: { userId: magic.data.user.id, actionLink: magicLink, created: false } }
  }

  return {
    ok:    false,
    error: magic.error ?? invite.error ?? { message: 'Could not generate invitation link' },
  }
}
