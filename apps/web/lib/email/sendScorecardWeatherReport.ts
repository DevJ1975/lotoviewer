import { sendEmail } from '@/lib/email/core'
import { unsubscribeFooterText, unsubscribeFooterHtml } from '@/lib/email/unsubscribe'
import { formatDelta, type WeatherMetricRow } from '@soteria/core/scorecardWeatherReport'

// Weekly EHS "weather report" email. Week-over-week movement on the key
// leading/lagging indicators plus TRIR/DART-to-date. Fail-soft (returns
// { sent }, never throws) so one Resend failure can't sink the cron batch.

export interface RiskDriverForEmail {
  label:        string
  value:        string
  target:       string
  contribution: number
  href:         string
}

export interface ScorecardWeatherReportArgs {
  to:            string
  recipientName?: string | null
  weekStart:     string
  rows:          WeatherMetricRow[]
  trir:          number | null
  dart:          number | null
  /** Year-to-date recordable injury count (the TRIR numerator). */
  recordablesYtd?: number | null
  appUrl:        string
  tenantName?:   string | null
  tenantId?:     string | null
  /** Data-driven incident-risk score (0–100) + band + the ranked drivers
   *  ("where to focus"). Omitted when unavailable. */
  risk?:         { score: number; band: string; drivers: RiskDriverForEmail[] } | null
  /** RFC 8058 unsubscribe URL. When set, adds the List-Unsubscribe headers
   *  and a footer link; omit it and the email goes out unchanged. */
  unsubscribeUrl?: string | null
}

const TONE_COLOR: Record<WeatherMetricRow['tone'], string> = {
  good: '#047857',
  bad: '#b91c1c',
  neutral: '#475569',
}

// Risk-band accent used by the gauge + driver bars. Mid-tones chosen to stay
// legible on the white email card.
const BAND_COLOR: Record<string, string> = {
  low:      '#047857',
  moderate: '#b45309',
  high:     '#c2410c',
  extreme:  '#b91c1c',
}

// Email-safe horizontal bar: a two-cell table (filled + remainder). No flexbox,
// no SVG, no background-image — renders in Gmail, Outlook and Apple Mail.
function bar(pct: number, color: string): string {
  const w = Math.max(0, Math.min(100, Math.round(pct)))
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7;border-radius:5px;border-collapse:separate;"><tr>`
    + `<td height="8" width="${w}%" style="height:8px;line-height:8px;font-size:0;background:${color};border-radius:5px;">&nbsp;</td>`
    + `<td height="8" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td>`
    + `</tr></table>`
}

export async function sendScorecardWeatherReport(args: ScorecardWeatherReportArgs): Promise<{ sent: boolean }> {
  const subject = `[Weekly] EHS weather report — week of ${args.weekStart}`
  const unsub = args.unsubscribeUrl ?? null
  const text = renderText(args, unsub)
  const html = renderHtml(args, unsub)

  // Idempotency: at most one weekly report per (tenant, week, recipient). A
  // cron re-run or Vercel double-fire re-claims the same key and is skipped.
  const dedupeKey = `scorecard-weather:${args.tenantId ?? 'na'}:${args.weekStart}:${args.to.toLowerCase()}`

  const { sent } = await sendEmail({
    kind: 'scorecard-weather',
    to: args.to,
    subject, text, html,
    tenantId: args.tenantId ?? null,
    unsubscribeUrl: unsub,
    dedupeKey,
  })
  return { sent }
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
  const ytdRec = typeof a.recordablesYtd === 'number' ? `\n  Recordables: ${a.recordablesYtd}` : ''
  const riskBlock = a.risk
    ? `\nPredicted incident risk: ${Math.round(a.risk.score)}/100 (${a.risk.band})`
      + (a.risk.drivers.length > 0
          ? `\nWhere to focus:\n${a.risk.drivers.map(d => `  • ${d.label} — ${d.value} (target ${d.target})`).join('\n')}`
          : '')
      + '\n'
    : ''
  return `Hi ${name},

EHS weather report${a.tenantName ? ` for ${a.tenantName}` : ''} — week of ${a.weekStart}.

Week over week:
${lines.join('\n')}

Year to date:
  TRIR: ${fmtRate(a.trir)}
  DART: ${fmtRate(a.dart)}${ytdRec}
${riskBlock}
Full scorecard: ${a.appUrl}/admin/insights/scorecard

— SoteriaField
${unsubscribeUrl ? unsubscribeFooterText(unsubscribeUrl) : ''}`
}

function renderHtml(a: ScorecardWeatherReportArgs, unsubscribeUrl: string | null): string {
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const name = safe(a.recipientName || a.to.split('@')[0]!)
  const base = a.appUrl.replace(/\/$/, '')

  // Week-over-week: each indicator gets paired this-wk / last-wk bars, scaled
  // to the larger of the two so the movement is legible at a glance.
  const metricBlocks = a.rows.map(r => {
    const scale = Math.max(r.current, r.previous, 1)
    const tone = TONE_COLOR[r.tone]
    return `
        <tr><td style="padding:14px 0 0 0;border-top:1px solid #eef2f7;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;font-weight:700;color:#1a2230;">${safe(r.label)}</td>
            <td style="text-align:right;font-size:14px;font-weight:800;color:#1a2230;">${r.current}${r.unit ? ' ' + safe(r.unit) : ''}<span style="font-size:12px;font-weight:700;color:${tone};">&nbsp;&nbsp;${safe(formatDelta(r))}</span></td>
          </tr></table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:7px;">
            <tr><td width="48" style="font-size:10px;color:#8a94a3;">This wk</td><td>${bar(r.current / scale * 100, tone)}</td></tr>
            <tr><td colspan="2" style="height:5px;line-height:5px;font-size:0;">&nbsp;</td></tr>
            <tr><td width="48" style="font-size:10px;color:#8a94a3;">Last wk</td><td>${bar(r.previous / scale * 100, '#cbd5e1')}</td></tr>
          </table>
        </td></tr>`
  }).join('')

  // Predicted incident-risk gauge + ranked drivers (each bar scaled to the
  // biggest driver so the relative pressure is clear).
  let riskSection = ''
  if (a.risk) {
    const bandColor = BAND_COLOR[a.risk.band] ?? '#475569'
    const maxContrib = Math.max(...a.risk.drivers.map(d => d.contribution), 1)
    const driverRows = a.risk.drivers.map(d => `
            <tr><td style="padding:11px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-size:13px;font-weight:600;color:#1a2230;"><a href="${safe(base + d.href)}" style="color:#1a2230;text-decoration:none;">${safe(d.label)}</a></td>
                <td style="text-align:right;font-size:11px;color:#5b6675;white-space:nowrap;">${safe(d.value)} · target ${safe(d.target)}</td>
              </tr></table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:5px;"><tr><td>${bar(d.contribution / maxContrib * 100, bandColor)}</td></tr></table>
            </td></tr>`).join('')
    riskSection = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border:1px solid #e6ebf2;border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b6675;">Predicted incident risk</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:4px;"><tr>
            <td style="font-size:30px;font-weight:800;color:#1a2230;line-height:1;">${Math.round(a.risk.score)}<span style="font-size:14px;color:#8a94a3;font-weight:600;">/100</span></td>
            <td style="text-align:right;"><span style="background:${bandColor};color:#ffffff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:4px 11px;border-radius:999px;">${safe(a.risk.band)}</span></td>
          </tr></table>
          <div style="margin-top:9px;">${bar(a.risk.score, bandColor)}</div>
          <div style="font-size:11px;color:#8a94a3;margin-top:7px;">Data-driven from leading + lagging indicators. Not a compliance determination.</div>
          ${a.risk.drivers.length > 0 ? `
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b6675;margin-top:16px;">Where to focus to lower it</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${driverRows}</table>` : ''}
        </td></tr>
      </table>`
  }

  const statCard = (label: string, value: string) => `
            <td width="33%" style="padding:13px 14px;background:#f6f8fb;border-radius:10px;" valign="top">
              <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#5b6675;">${label}</div>
              <div style="font-size:22px;font-weight:800;margin-top:3px;color:#1a2230;">${value}</div>
            </td>`
  const ytdRecordables = typeof a.recordablesYtd === 'number' ? String(a.recordablesYtd) : 'n/a'

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#1D3ECF;padding:22px 26px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · EHS Weather Report</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px;">Week of ${safe(a.weekStart)}${a.tenantName ? ` · ${safe(a.tenantName)}` : ''}</div>
    </td></tr>
    <tr><td style="padding:24px 26px;">
      <p style="margin:0 0 4px 0;font-size:15px;">Hi ${name}, here's how the week moved.</p>
      ${riskSection}

      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b6675;margin:22px 0 2px 0;">This week vs last</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${metricBlocks}
      </table>

      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5b6675;margin:22px 0 8px 0;">Year to date</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${statCard('TRIR', fmtRate(a.trir))}<td style="width:10px;">&nbsp;</td>${statCard('DART', fmtRate(a.dart))}<td style="width:10px;">&nbsp;</td>${statCard('Recordables', ytdRecordables)}
      </tr></table>

      <p style="margin:22px 0 0 0;text-align:center;">
        <a href="${safe(base)}/admin/insights/scorecard" style="display:inline-block;background:#1D3ECF;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:10px;">Open the scorecard →</a>
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:14px 26px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">Sent weekly from SoteriaField${unsubscribeUrl ? unsubscribeFooterHtml(unsubscribeUrl) : ''}</td></tr>
  </table>
</td></tr></table>
</body></html>`
}
