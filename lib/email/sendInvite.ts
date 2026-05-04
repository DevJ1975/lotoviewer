// Shared invite-email helper. Used by both:
//   /api/admin/users/route.ts          — single-tenant admin invite
//   /api/superadmin/tenants/[number]/members/route.ts — multi-tenant invite
//
// Returns true on successful send. Returns false (and logs to Sentry) when
// RESEND_API_KEY isn't set, when Resend rejects the request, or when the
// network call throws. Callers bubble the boolean back to the UI as
// `emailSent` so the admin can fall back to copy-pasting the temp password.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'

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
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[invite-email] RESEND_API_KEY not set — skipping send')
    return false
  }

  // From-address precedence:
  //   INVITE_FROM_EMAIL  — preferred once Soteria's domain is verified
  //   SUPPORT_FROM_EMAIL — fallback to the bug-report sender
  //   onboarding@resend.dev — Resend's test sender (works without DNS)
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const displayName = args.fullName || args.to.split('@')[0]!
  const isExisting = !args.tempPassword
  const subject = isExisting
    ? (args.tenantName
        ? `You've been added to ${args.tenantName} on Soteria FIELD`
        : "You've been added to a tenant on Soteria FIELD")
    : (args.tenantName
        ? `You're invited to ${args.tenantName} on Soteria FIELD`
        : "You're invited to Soteria FIELD")

  const text = renderText({ displayName, isExisting, ...args })
  const html = renderHtml({ displayName, isExisting, ...args })

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendInviteEmail', stage: 'resend' } })
      console.error('[invite-email] Resend rejected the send', error)
      return false
    }
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendInviteEmail', stage: 'resend' } })
    console.error('[invite-email] send threw', err)
    return false
  }
}

function renderText(a: InviteEmailArgs & { displayName: string; isExisting: boolean }): string {
  if (a.isExisting) {
    return `Hi ${a.displayName},

You've been added to ${a.tenantName ?? 'a new tenant'} on Soteria FIELD.

Sign in with your existing account:
  ${a.loginUrl}/login

Once you sign in, the new tenant will appear in the tenant switcher
in the app header.

If you have any trouble signing in, just reply to this email.

— Soteria FIELD
`
  }

  const tenantLine = a.tenantName ? `\n  Tenant:    ${a.tenantName}\n` : ''
  return `Hi ${a.displayName},

You've been invited to Soteria FIELD — your team's safety operations app
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

— Soteria FIELD
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
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">You've been added to ${tenantPhrase}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">A superadmin added you to <strong>${tenantPhrase}</strong> on Soteria FIELD. Sign in with your existing account — the new tenant will show up in the tenant switcher in the app header.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to Soteria FIELD →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Trouble signing in? Just reply to this email.
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from Soteria FIELD · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
  }

  const tenantBlock = a.tenantName ? `
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Tenant</div>
          <div style="margin-top:2px;">${safe(a.tenantName)}</div>` : ''
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">You're invited</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">You've been invited to Soteria FIELD — your team's safety operations app (LOTO, Confined Space, and Hot Work permits).</p>
      <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;">Tap the button below to sign in. Your one-time password is just under it — you'll be asked to set your own password on first login.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to Soteria FIELD →</a>
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
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from Soteria FIELD · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
