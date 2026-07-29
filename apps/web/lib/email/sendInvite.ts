// Shared invite-email helper. Used by lib/invites/provision.ts on behalf of:
//   /api/admin/users/route.ts          — single-tenant admin invite
//   /api/superadmin/tenants/[number]/members/route.ts — multi-tenant invite
//   /api/admin/members/[memberId]/grant-login/route.ts — roster grant-login
//   /api/superadmin/.../resend-invite/route.ts — fresh-link resend
//
// The invite carries a single-use accept-invite LINK — never a password.
// (Passwords in email bodies are a phishing-content pattern spam filters
// score against, and were the main content-level reason invites landed in
// junk folders.) The temp password still exists server-side purely as the
// admin's copy-paste fallback when email delivery fails.
//
// Returns true on successful send, false when the send was skipped or
// rejected. Callers bubble the boolean back to the UI as `emailSent` so the
// admin can fall back to sharing the link or password.
//
// The send plumbing — from-address ladder, transient-error retry, Sentry
// capture, and the email_log write — lives in lib/email/core.ts. This file
// owns only the invite's content.

import { sendEmail } from '@/lib/email/core'

export interface InviteEmailArgs {
  to:            string
  fullName:      string
  // Empty string = "this user already has an account; we're notifying
  // them they were added to a new tenant" (no link needed).
  // Non-empty = a brand new (or never-signed-in) account; the email
  // carries the single-use accept-invite link.
  inviteUrl:     string
  loginUrl:      string
  // Optional context — tenant name shows up in the subject + body so a
  // user invited to multiple tenants can tell which one this is for.
  tenantName?:   string
  /** How long the invite link stays valid; shown in the email copy. */
  expiresInDays?: number
}

// Pick the public origin to put in invite emails. Order:
//   1. NEXT_PUBLIC_APP_URL env (set in Vercel for branded links)
//   2. The request's Origin / Host header
//   3. Generic fallback
export function computeLoginUrl(req: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envUrl) return envUrl.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

// The "just reply to this email" copy is real: replies route to a
// monitored mailbox. The invites@ sender domain has no inbound mail, so
// without an explicit Reply-To every reply would bounce.
export function inviteReplyTo(): string {
  return process.env.INVITE_REPLY_TO_EMAIL?.trim() || 'jamil@trainovations.com'
}

export async function sendInviteEmail(args: InviteEmailArgs): Promise<boolean> {
  const displayName = args.fullName || args.to.split('@')[0]!
  const isExisting = !args.inviteUrl
  const subject = isExisting
    ? (args.tenantName
        ? `You've been added to ${args.tenantName} on SoteriaField`
        : "You've been added to a tenant on SoteriaField")
    : (args.tenantName
        ? `You're invited to ${args.tenantName} on SoteriaField`
        : "You're invited to SoteriaField")

  const text = renderText({ displayName, isExisting, ...args })
  const html = renderHtml({ displayName, isExisting, ...args })

  const { sent } = await sendEmail({
    kind: 'invite', to: args.to, subject, text, html,
    replyTo: inviteReplyTo(),
  })
  return sent
}

function expiryPhrase(expiresInDays?: number): string {
  const days = expiresInDays && expiresInDays > 0 ? expiresInDays : 14
  return `${days} days`
}

function renderText(a: InviteEmailArgs & { displayName: string; isExisting: boolean }): string {
  if (a.isExisting) {
    return `Hi ${a.displayName},

You've been added to ${a.tenantName ?? 'a new tenant'} on SoteriaField.

Sign in with your existing account:
  ${a.loginUrl}/login

Once you sign in, the new tenant will appear in the tenant switcher
in the app header.

If you have any trouble signing in, just reply to this email.

— SoteriaField
`
  }

  const tenantLine = a.tenantName ? `You've been invited to join ${a.tenantName} on SoteriaField` : "You've been invited to SoteriaField"
  return `Hi ${a.displayName},

${tenantLine} — your team's safety operations app
(LOTO + Confined Space + Hot Work permits).

Accept your invitation and choose your password here:
  ${a.inviteUrl}

This link is just for you. It can be used once and expires in
${expiryPhrase(a.expiresInDays)}. If it has expired, you can request a
fresh one from the same page.

If you have any trouble, just reply to this email.

— SoteriaField
`
}

function renderHtml(a: InviteEmailArgs & { displayName: string; isExisting: boolean }): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  if (a.isExisting) {
    const tenantPhrase = a.tenantName ? safe(a.tenantName) : 'a new tenant'
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">You've been added to ${tenantPhrase}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">A superadmin added you to <strong>${tenantPhrase}</strong> on SoteriaField. Sign in with your existing account — the new tenant will show up in the tenant switcher in the app header.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to SoteriaField →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Trouble signing in? Just reply to this email.
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from SoteriaField · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
  }

  const tenantIntro = a.tenantName
    ? `You've been invited to join <strong>${safe(a.tenantName)}</strong> on SoteriaField`
    : `You've been invited to SoteriaField`
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">You're invited</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">${tenantIntro} — your team's safety operations app (LOTO, Confined Space, and Hot Work permits).</p>
      <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;">Tap the button below to accept your invitation and choose your password.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.inviteUrl)}" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Accept your invitation →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        This link is just for you. It can be used once and expires in ${expiryPhrase(a.expiresInDays)} — if it has expired, you can request a fresh one from the same page.
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Trouble accepting the invitation? Just reply to this email.
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from SoteriaField · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
