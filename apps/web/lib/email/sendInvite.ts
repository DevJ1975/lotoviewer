// Shared invite-email helper. Used by both:
//   /api/admin/users/route.ts          — single-tenant admin invite
//   /api/superadmin/tenants/[number]/members/route.ts — multi-tenant invite
//
// Returns true on a successful send. The send/log/error plumbing lives in
// lib/email/core.ts (sendEmail) — this file owns only the invite content.
// Callers bubble the boolean back to the UI as `emailSent` so the admin can
// fall back to copy-pasting the temp password.

import { sendEmail } from '@/lib/email/core'
import { renderEmailLayout, escapeHtml } from '@/lib/email/layout'

export interface InviteEmailArgs {
  to:           string
  fullName:     string
  // Empty string = "this user already has an account; we're notifying
  // them they were added to a new tenant" (no temp password to share).
  // Non-empty = a brand new account; the email shows the password so
  // they can log in for the first time.
  tempPassword: string
  loginUrl:     string
  // Optional context — tenant name shows up in the subject + body so a
  // user invited to multiple tenants can tell which one this is for.
  tenantName?:  string
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

export async function sendInviteEmail(args: InviteEmailArgs): Promise<boolean> {
  const displayName = args.fullName || args.to.split('@')[0]!
  const isExisting = !args.tempPassword
  const subject = isExisting
    ? (args.tenantName
        ? `You've been added to ${args.tenantName} on SoteriaField`
        : "You've been added to a tenant on SoteriaField")
    : (args.tenantName
        ? `You're invited to ${args.tenantName} on SoteriaField`
        : "You're invited to SoteriaField")

  const text = renderText({ displayName, isExisting, ...args })
  const html = renderHtml({ displayName, isExisting, ...args })

  const { sent } = await sendEmail({ kind: 'invite', to: args.to, subject, text, html })
  return sent
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

  const tenantLine = a.tenantName ? `\n  Tenant:    ${a.tenantName}\n` : ''
  return `Hi ${a.displayName},

You've been invited to SoteriaField — your team's safety operations app
(LOTO + Confined Space + Hot Work permits).

Sign in here:
  ${a.loginUrl}/login

Your one-time login:
  Email:     ${a.to}
  Password:  ${a.tempPassword}${tenantLine}
On your first login you'll be asked to set a new password of your own
(at least 8 characters). The password above only works until you change
it, and you must change it on first login.

If you have any trouble signing in, just reply to this email.

— SoteriaField
`
}

function renderHtml(a: InviteEmailArgs & { displayName: string; isExisting: boolean }): string {
  const safe = escapeHtml
  const footerHtml = `Sent from SoteriaField · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>`

  if (a.isExisting) {
    const tenantPhrase = a.tenantName ? safe(a.tenantName) : 'a new tenant'
    return renderEmailLayout({
      heading: `You've been added to ${tenantPhrase}`,
      footerHtml,
      contentHtml: `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">A superadmin added you to <strong>${tenantPhrase}</strong> on SoteriaField. Sign in with your existing account — the new tenant will show up in the tenant switcher in the app header.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to SoteriaField →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Trouble signing in? Just reply to this email.
      </p>`,
    })
  }

  const tenantBlock = a.tenantName ? `
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Tenant</div>
          <div style="margin-top:2px;">${safe(a.tenantName)}</div>` : ''
  return renderEmailLayout({
    heading: "You're invited",
    footerHtml,
    contentHtml: `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">You've been invited to SoteriaField — your team's safety operations app (LOTO, Confined Space, and Hot Work permits).</p>
      <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;">Tap the button below to sign in. Your one-time password is just under it — you'll be asked to set your own password on first login.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to SoteriaField →</a>
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Email</div>
          <div style="margin-top:2px;">${safe(a.to)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">One-time password</div>
          <div style="margin-top:2px;letter-spacing:.04em;">${safe(a.tempPassword)}</div>${tenantBlock}
        </td></tr>
      </table>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        The password above only works until you change it, and you must change it on first login. Use at least 8 characters.
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Trouble signing in? Just reply to this email.
      </p>`,
  })
}
