// Weekly trends digest — fired every Monday morning. Bundles the
// past week's leading + lagging signals into a single email that an
// EHS director can scan over coffee.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

export interface IncidentTrendsDigestArgs {
  to:                       string
  recipientName?:           string | null
  /** ISO date — Monday of the week being summarised. */
  weekStart:                string
  newIncidents7d:           number
  newRecordable7d:          number
  newNearMiss7d:            number
  openCriticalActions:      number    // overdue + due-this-week, owner-agnostic
  daysSinceLastRecordable:  number    // -1 sentinel for none
  trir:                     number | null
  dart:                     number | null
  appUrl:                   string
  tenantName?:              string | null
  tenantId?:                string | null
}

export async function sendIncidentTrendsDigest(args: IncidentTrendsDigestArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const subject = `[Weekly] Safety digest — week of ${args.weekStart}`
  const tenantId = args.tenantId ?? null

  if (!apiKey) {
    await logEmailSend({
      kind: 'incident-trends-digest', to: args.to, subject,
      tenantId, status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return false
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const link = `${args.appUrl.replace(/\/$/, '')}/incidents/scorecard`
  const name = args.recipientName?.trim() || args.to.split('@')[0]!

  const text = `Hi ${name},

Weekly safety digest — week of ${args.weekStart}.

Past 7 days
  New incidents:            ${args.newIncidents7d}
  Recordable:               ${args.newRecordable7d}
  Near miss:                ${args.newNearMiss7d}

Right now
  Open critical CAPAs:      ${args.openCriticalActions}
  Days since last recordable: ${args.daysSinceLastRecordable < 0 ? '—' : args.daysSinceLastRecordable}
  TRIR:                     ${args.trir == null ? '—' : args.trir.toFixed(2)}
  DART:                     ${args.dart == null ? '—' : args.dart.toFixed(2)}

Open the full scorecard:
  ${link}

— SoteriaField
`

  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const tile = (label: string, value: string) => `
    <td style="padding:8px 6px;text-align:center;border:1px solid #e6ebf2;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#5b6675;font-weight:700;">${safe(label)}</div>
      <div style="font-size:18px;font-weight:800;color:#1a2230;margin-top:2px;">${safe(value)}</div>
    </td>`

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Weekly digest</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">Safety scorecard — ${safe(args.weekStart)}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 8px 0;font-size:11px;color:#5b6675;text-transform:uppercase;letter-spacing:.12em;font-weight:700;">Past 7 days</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:16px;">
        <tr>
          ${tile('New incidents', String(args.newIncidents7d))}
          ${tile('Recordable',    String(args.newRecordable7d))}
          ${tile('Near miss',     String(args.newNearMiss7d))}
        </tr>
      </table>
      <p style="margin:0 0 8px 0;font-size:11px;color:#5b6675;text-transform:uppercase;letter-spacing:.12em;font-weight:700;">Right now</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:8px;">
        <tr>
          ${tile('Critical CAPAs', String(args.openCriticalActions))}
          ${tile('Days since recordable', args.daysSinceLastRecordable < 0 ? '—' : String(args.daysSinceLastRecordable))}
          ${tile('TRIR', args.trir == null ? '—' : args.trir.toFixed(2))}
          ${tile('DART', args.dart == null ? '—' : args.dart.toFixed(2))}
        </tr>
      </table>
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:#214488;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open full scorecard →</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendIncidentTrendsDigest', stage: 'resend' } })
      await logEmailSend({
        kind: 'incident-trends-digest', to: args.to, subject,
        tenantId, status: 'failed', errorText: error.message,
      })
      return false
    }
    await logEmailSend({
      kind: 'incident-trends-digest', to: args.to, subject,
      tenantId, status: 'sent', providerId: data?.id ?? null,
    })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendIncidentTrendsDigest' } })
    await logEmailSend({
      kind: 'incident-trends-digest', to: args.to, subject,
      tenantId, status: 'failed',
      errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
