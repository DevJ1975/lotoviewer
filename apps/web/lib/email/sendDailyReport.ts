import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

// Daily superadmin health-narrative email.
//
// Sent by /api/cron/superadmin-daily-report once per UTC day, to every
// allowlisted superadmin. Intentionally short — the email is a hook
// that pulls a busy operator into the dashboard, not a replacement
// for it.

export interface DailyReportEmailArgs {
  to:           string
  forDate:      string         // YYYY-MM-DD
  narrative:    string
  anomalies:    string[]
  reportUrl:    string
}

export async function sendDailyReport(
  args: DailyReportEmailArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[daily-report] RESEND_API_KEY not set — skipping send')
    await logEmailSend({
      kind: 'superadmin-daily-report', to: args.to,
      status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return { sent: false, providerId: null }
  }

  const from = process.env.SUPPORT_FROM_EMAIL
            ?? process.env.INVITE_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'
  const subject = `Soteria health · ${args.forDate}${args.anomalies.length > 0 ? ` · ${args.anomalies.length} anomaly${args.anomalies.length === 1 ? '' : 's'}` : ''}`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to:        args.to,
      subject,
      text:      renderText(args),
      html:      renderHtml(args),
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendDailyReport', stage: 'resend' } })
      await logEmailSend({
        kind: 'superadmin-daily-report', to: args.to, subject,
        status: 'failed', errorText: error.message,
      })
      return { sent: false, providerId: null }
    }
    await logEmailSend({
      kind: 'superadmin-daily-report', to: args.to, subject,
      status: 'sent', providerId: data?.id ?? null,
    })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendDailyReport', stage: 'resend' } })
    await logEmailSend({
      kind: 'superadmin-daily-report', to: args.to, subject,
      status: 'failed', errorText: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, providerId: null }
  }
}

function renderText(a: DailyReportEmailArgs): string {
  const lines = [
    `Soteria FIELD — health report for ${a.forDate}`,
    '',
    a.narrative,
  ]
  if (a.anomalies.length > 0) {
    lines.push('', 'Anomalies:')
    for (const x of a.anomalies) lines.push(`  • ${x}`)
  }
  lines.push('', `Open the dashboard: ${a.reportUrl}`)
  return lines.join('\n')
}

function renderHtml(a: DailyReportEmailArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const anomaliesBlock = a.anomalies.length > 0
    ? `<div style="margin-top:14px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
         <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9a3412;margin-bottom:6px;">Anomalies</div>
         <ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.55;color:#9a3412;">
           ${a.anomalies.map(x => `<li>${safe(x)}</li>`).join('')}
         </ul>
       </div>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">
        Soteria FIELD · Daily health
      </div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">
        ${safe(a.forDate)}
      </div>
    </td></tr>
    <tr><td style="padding:22px 28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">${safe(a.narrative)}</p>
      ${anomaliesBlock}
      <p style="margin:18px 0 0 0;">
        <a href="${safe(a.reportUrl)}" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 16px;border-radius:8px;">Open dashboard →</a>
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:14px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      You're getting this because you're a superadmin. Edit the allowlist via env to opt out.
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
