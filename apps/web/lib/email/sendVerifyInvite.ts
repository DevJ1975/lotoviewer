// Verify-and-set-password invite email. Sent to brand-new (or re-invited)
// users in place of the old temp-password message: it carries a single link
// that both verifies the recipient owns the mailbox and lets them set their
// own password. See lib/auth/inviteLink.ts for how the link is minted.
//
// Returns true on a successful send. Send/log/error plumbing lives in
// lib/email/core.ts — callers surface the boolean so the admin knows whether
// the link went out and can resend.

import { sendEmail } from '@/lib/email/core'
import { renderEmailLayout, escapeHtml } from '@/lib/email/layout'

export interface VerifyInviteArgs {
  to:          string
  fullName:    string
  // The Supabase action link that verifies the mailbox + opens /welcome.
  verifyUrl:   string
  // Optional tenant context for the subject/body when a user is invited to a
  // specific tenant.
  tenantName?: string
}

export async function sendVerifyInviteEmail(args: VerifyInviteArgs): Promise<boolean> {
  const displayName = args.fullName || args.to.split('@')[0]!
  const subject = args.tenantName
    ? `Verify your email to join ${args.tenantName} on SoteriaField`
    : 'Verify your email to activate your SoteriaField account'

  const text = renderText({ displayName, ...args })
  const html = renderHtml({ displayName, ...args })

  const { sent } = await sendEmail({ kind: 'verify_invite', to: args.to, subject, text, html })
  return sent
}

function renderText(a: VerifyInviteArgs & { displayName: string }): string {
  const tenantLine = a.tenantName
    ? `You've been invited to ${a.tenantName} on SoteriaField`
    : "You've been invited to SoteriaField"
  return `Hi ${a.displayName},

${tenantLine} — your team's safety operations app (LOTO, Confined Space,
and Hot Work permits).

To activate your account, confirm this is your email and set a password:
  ${a.verifyUrl}

This link verifies your email address and takes you to a page where you'll
choose your own password. It can only be used once and expires after a while —
if it stops working, ask whoever invited you to resend it.

If you weren't expecting this invitation, you can safely ignore this email;
no account is active until the link above is used.

— SoteriaField
`
}

function renderHtml(a: VerifyInviteArgs & { displayName: string }): string {
  const safe = escapeHtml
  const tenantPhrase = a.tenantName
    ? `You've been invited to <strong>${safe(a.tenantName)}</strong> on SoteriaField`
    : "You've been invited to SoteriaField"

  return renderEmailLayout({
    heading: 'Verify your email',
    footerHtml: 'Sent from SoteriaField · soteriafield.app',
    contentHtml: `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">${tenantPhrase} — your team's safety operations app (LOTO, Confined Space, and Hot Work permits).</p>
      <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;">Confirm this is your email and set a password to activate your account:</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.verifyUrl)}" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Verify email &amp; set password →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        This link can only be used once and expires after a while. If it stops working, ask whoever invited you to resend it. If you weren't expecting this invitation you can ignore this email — no account is active until the link is used.
      </p>`,
  })
}
