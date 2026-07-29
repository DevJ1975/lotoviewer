// Invite-reminder email. Sent by /api/cron/invite-reminders to people who
// were invited but have never signed in. Mirrors the structure and
// fail-soft behaviour of sendInvite.ts: returns { sent, providerId } and
// never throws, so one Resend failure can't sink the cron's batch.
//
// We deliberately do NOT include a password — the one-time password lives
// only in the original invite email. The reminder points to /login and, as
// a fallback, the password-reset flow.

import { sendEmail } from '@/lib/email/core'

export interface InviteReminderArgs {
  to:             string
  fullName:       string
  loginUrl:       string
  tenantName?:    string
  /** 1-based reminder number (1..maxReminders). */
  reminderNumber: number
  maxReminders:   number
  tenantId?:      string | null
}

export interface InviteReminderResult {
  sent:       boolean
  providerId: string | null
}

export async function sendInviteReminder(
  args: InviteReminderArgs,
): Promise<InviteReminderResult> {
  const isFinal = args.reminderNumber >= args.maxReminders
  const tenantSuffix = args.tenantName ? ` to ${args.tenantName}` : ''
  const subject = isFinal
    ? `Final reminder: activate your SoteriaField account${tenantSuffix}`
    : `Reminder: finish setting up your SoteriaField account${tenantSuffix}`

  const text = renderText({ ...args, isFinal })
  const html = renderHtml({ ...args, isFinal })

  return sendEmail({
    kind: 'invite-reminder',
    to: args.to,
    subject, text, html,
    tenantId: args.tenantId ?? null,
  })
}

type RenderArgs = InviteReminderArgs & { isFinal: boolean }

function renderText(a: RenderArgs): string {
  const displayName = a.fullName || a.to.split('@')[0]!
  const tenantLine = a.tenantName ? ` for ${a.tenantName}` : ''
  const closing = a.isFinal
    ? `This is the last reminder. If you don't sign in soon, this invitation
will be cancelled and an administrator will need to invite you again.`
    : `If you've misplaced the one-time password from your invitation, you can
reset it here:
  ${a.loginUrl}/forgot-password`

  return `Hi ${displayName},

You were invited to SoteriaField${tenantLine} but haven't signed in yet.

Sign in to finish setting up your account:
  ${a.loginUrl}/login

Use the one-time password from your original invitation email — you'll be
asked to set your own password on first login.

${closing}

Trouble signing in? Just reply to this email.

— SoteriaField
`
}

function renderHtml(a: RenderArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const displayName = safe(a.fullName || a.to.split('@')[0]!)
  const tenantPhrase = a.tenantName ? safe(a.tenantName) : null
  const tenantLine = tenantPhrase ? ` for <strong>${tenantPhrase}</strong>` : ''
  const closing = a.isFinal
    ? `<p style="margin:18px 0 0 0;font-size:13px;line-height:1.55;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;">
        This is the last reminder. If you don't sign in soon, this invitation will be cancelled and an administrator will need to invite you again.
      </p>`
    : `<p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Misplaced the one-time password from your invitation? <a href="${safe(a.loginUrl)}/forgot-password" style="color:#214488;">Reset it here</a>.
      </p>`

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${a.isFinal ? 'Final reminder' : 'Finish setting up your account'}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${displayName},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">You were invited to SoteriaField${tenantLine} but haven't signed in yet. Tap below to finish setting up your account — use the one-time password from your original invitation email.</p>
      <p style="margin:0 0 8px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to SoteriaField →</a>
      </p>
      ${closing}
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">Trouble signing in? Just reply to this email.</p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from SoteriaField · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
