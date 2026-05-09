// 300A posting reminder — fires Jan 15 to remind tenant admins that
// they have until Feb 1 to post the 300A annual summary at every
// establishment for the prior year, and until Apr 30 to take it
// down. Same posture as the other helpers (boolean return, never
// throws, every send logged via instrument.ts).

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

export interface OshaPostingReminderArgs {
  to:                  string
  recipientName?:      string | null
  year:                number                          // The reporting year (Jan 15 2027 → year=2026)
  establishmentNames:  string[]                        // Establishments awaiting certification
  appUrl:              string
  tenantName?:         string | null
  tenantId?:           string | null
}

export async function sendOshaPostingReminder(args: OshaPostingReminderArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const subject = `[OSHA] Post your ${args.year} 300A by Feb 1`
  const tenantId = args.tenantId ?? null

  if (!apiKey) {
    await logEmailSend({
      kind: 'osha-300a-posting', to: args.to, subject,
      tenantId, status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return false
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const link = `${args.appUrl.replace(/\/$/, '')}/osha?year=${args.year}`
  const name = args.recipientName?.trim() || args.to.split('@')[0]!
  const estList = args.establishmentNames.length > 0
    ? args.establishmentNames.map(n => `  - ${n}`).join('\n')
    : '  (no establishments configured yet)'

  const text = `Hi ${name},

Your ${args.year} OSHA 300A annual summary needs to be certified and
posted at every establishment by February 1, ${args.year + 1}, and must
remain posted through April 30.

Establishments awaiting certification:
${estList}

Open the OSHA dashboard to certify, download the PDF, and post:
  ${link}

— SoteriaField
`

  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const estItems = args.establishmentNames.map(n => `<li>${safe(n)}</li>`).join('')
  const estBlock = args.establishmentNames.length > 0
    ? `<ul style="margin:8px 0 0 18px;padding:0;color:#1a2230;font-size:13px;">${estItems}</ul>`
    : `<p style="margin:8px 0 0 0;color:#5b6675;font-size:12px;font-style:italic;">No establishments configured yet.</p>`

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · OSHA reminder</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">Post your ${args.year} 300A by Feb 1</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
        Your <strong>${args.year}</strong> OSHA 300A annual summary needs to be certified and posted at every establishment by <strong>February 1, ${args.year + 1}</strong>, and must remain posted through April 30.
      </p>
      <p style="margin:0 0 8px 0;font-size:13px;color:#5b6675;text-transform:uppercase;letter-spacing:.12em;font-weight:700;">Establishments awaiting certification</p>
      ${estBlock}
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:#214488;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open OSHA dashboard →</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendOshaPostingReminder', stage: 'resend' } })
      await logEmailSend({
        kind: 'osha-300a-posting', to: args.to, subject,
        tenantId, status: 'failed', errorText: error.message,
      })
      return false
    }
    await logEmailSend({
      kind: 'osha-300a-posting', to: args.to, subject,
      tenantId, status: 'sent', providerId: data?.id ?? null,
    })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendOshaPostingReminder' } })
    await logEmailSend({
      kind: 'osha-300a-posting', to: args.to, subject,
      tenantId, status: 'failed',
      errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
