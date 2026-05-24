import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import { unsubscribeFooterText, unsubscribeFooterHtml } from '@/lib/email/unsubscribe'
import { formatDelta, type WeatherMetricRow } from '@soteria/core/scorecardWeatherReport'

// Weekly EHS "weather report" email. Week-over-week movement on the key
// leading/lagging indicators plus TRIR/DART-to-date. Fail-soft (returns
// { sent }, never throws) so one Resend failure can't sink the cron batch.

export interface ScorecardWeatherReportArgs {
  to:            string
  recipientName?: string | null
  weekStart:     string
  rows:          WeatherMetricRow[]
  trir:          number | null
  dart:          number | null
  appUrl:        string
  tenantName?:   string | null
  tenantId?:     string | null
  /** Data-driven incident-risk score (0–100) + band + the single biggest
   *  driver ("where to focus"). Omitted when unavailable. */
  risk?:         { score: number; band: string; topDriver?: string | null } | null
  /** RFC 8058 unsubscribe URL. When set, adds the List-Unsubscribe headers
   *  and a footer link; omit it and the email goes out unchanged. */
  unsubscribeUrl?: string | null
}

const TONE_COLOR: Record<WeatherMetricRow['tone'], string> = {
  good: '#047857',
  bad: '#b91c1c',
  neutral: '#475569',
}

export async function sendScorecardWeatherReport(args: ScorecardWeatherReportArgs): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await logEmailSend({ kind: 'scorecard-weather', to: args.to, tenantId: args.tenantId ?? null, status: 'skipped', errorText: 'RESEND_API_KEY not set' })
    return { sent: false }
  }
  const from = process.env.INVITE_FROM_EMAIL ?? process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'
  const subject = `[Weekly] EHS weather report — week of ${args.weekStart}`
  const unsub = args.unsubscribeUrl ?? null
  const text = renderText(args, unsub)
  const html = renderHtml(args, unsub)
  const headers = unsub
    ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : undefined

  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to: args.to, subject, text, html, headers })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendScorecardWeatherReport' } })
      await logEmailSend({ kind: 'scorecard-weather', to: args.to, subject, tenantId: args.tenantId ?? null, status: 'failed', errorText: error.message })
      return { sent: false }
    }
    await logEmailSend({ kind: 'scorecard-weather', to: args.to, subject, tenantId: args.tenantId ?? null, status: 'sent', providerId: data?.id ?? null })
    return { sent: true }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendScorecardWeatherReport' } })
    await logEmailSend({ kind: 'scorecard-weather', to: args.to, subject, tenantId: args.tenantId ?? null, status: 'failed', errorText: err instanceof Error ? err.message : String(err) })
    return { sent: false }
  }
}

// Render the exact HTML body of the weekly email without sending — used by
// the admin preview route so a client can see the report before it goes out.
export function renderWeatherReportHtml(args: ScorecardWeatherReportArgs): string {
  return renderHtml(args, args.unsubscribeUrl ?? null)
}

function fmtRate(v: number | null): string {
  return v === null ? 'n/a' : v.toFixed(2)
}

function renderText(a: ScorecardWeatherReportArgs, unsubscribeUrl: string | null): string {
  const name = a.recipientName || a.to.split('@')[0]!
  const lines = a.rows.map(r => `  ${r.label}: ${r.current} (was ${r.previous}) ${formatDelta(r)}`)
  return `Hi ${name},

EHS weather report${a.tenantName ? ` for ${a.tenantName}` : ''} — week of ${a.weekStart}.

Week over week:
${lines.join('\n')}

To date:
  TRIR: ${fmtRate(a.trir)}
  DART: ${fmtRate(a.dart)}
${a.risk ? `
Predicted incident risk: ${Math.round(a.risk.score)}/100 (${a.risk.band})${a.risk.topDriver ? `\n  Focus area: ${a.risk.topDriver}` : ''}
` : ''}
Full scorecard: ${a.appUrl}/admin/insights/scorecard

— SoteriaField
${unsubscribeUrl ? unsubscribeFooterText(unsubscribeUrl) : ''}`
}

function renderHtml(a: ScorecardWeatherReportArgs, unsubscribeUrl: string | null): string {
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const name = safe(a.recipientName || a.to.split('@')[0]!)
  const rows = a.rows.map(r => `
        <tr>
          <td style="padding:8px 10px;border-top:1px solid #e6ebf2;font-size:13px;color:#1a2230;">${safe(r.label)}</td>
          <td style="padding:8px 10px;border-top:1px solid #e6ebf2;font-size:13px;font-weight:700;text-align:right;color:#1a2230;">${r.current}${r.unit ? ' ' + safe(r.unit) : ''}</td>
          <td style="padding:8px 10px;border-top:1px solid #e6ebf2;font-size:12px;text-align:right;color:#5b6675;">${r.previous}</td>
          <td style="padding:8px 10px;border-top:1px solid #e6ebf2;font-size:13px;font-weight:700;text-align:right;color:${TONE_COLOR[r.tone]};">${safe(formatDelta(r))}</td>
        </tr>`).join('')

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#1D3ECF;padding:22px 26px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · EHS Weather Report</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px;">Week of ${safe(a.weekStart)}${a.tenantName ? ` · ${safe(a.tenantName)}` : ''}</div>
    </td></tr>
    <tr><td style="padding:24px 26px;">
      <p style="margin:0 0 14px 0;font-size:15px;">Hi ${name}, here's how the week moved.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6ebf2;border-radius:10px;border-collapse:separate;">
        <tr>
          <td style="padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6675;">Indicator</td>
          <td style="padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;color:#5b6675;">This wk</td>
          <td style="padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;color:#5b6675;">Last wk</td>
          <td style="padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;text-align:right;color:#5b6675;">Change</td>
        </tr>${rows}
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
        <tr>
          <td style="width:50%;padding:12px 14px;background:#f6f8fb;border-radius:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6675;">TRIR (to date)</div>
            <div style="font-size:22px;font-weight:800;margin-top:2px;">${fmtRate(a.trir)}</div>
          </td>
          <td style="width:12px;"></td>
          <td style="width:50%;padding:12px 14px;background:#f6f8fb;border-radius:10px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6675;">DART (to date)</div>
            <div style="font-size:22px;font-weight:800;margin-top:2px;">${fmtRate(a.dart)}</div>
          </td>
        </tr>
      </table>
      ${a.risk ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border:1px solid #e6ebf2;border-radius:10px;">
        <tr><td style="padding:12px 14px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6675;">Predicted incident risk</div>
          <div style="font-size:22px;font-weight:800;margin-top:2px;">${Math.round(a.risk.score)}<span style="font-size:13px;color:#5b6675;font-weight:600;">/100 · ${safe(a.risk.band)}</span></div>
          ${a.risk.topDriver ? `<div style="font-size:12px;color:#5b6675;margin-top:4px;">Focus area: ${safe(a.risk.topDriver)}</div>` : ''}
        </td></tr>
      </table>` : ''}
      <p style="margin:20px 0 0 0;text-align:center;">
        <a href="${safe(a.appUrl)}/admin/insights/scorecard" style="display:inline-block;background:#1D3ECF;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:10px;">Open the scorecard →</a>
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:14px 26px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">Sent weekly from SoteriaField${unsubscribeUrl ? unsubscribeFooterHtml(unsubscribeUrl) : ''}</td></tr>
  </table>
</td></tr></table>
</body></html>`
}
