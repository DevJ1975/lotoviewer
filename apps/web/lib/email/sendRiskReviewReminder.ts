import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'

// Review-cadence reminder email.
//
// Sent by /api/cron/risk-review-reminders to risk owners whose
// next_review_date is in the past. One email per (tenant, owner)
// pair, with all of that owner's overdue risks listed inline so
// they get a single digest rather than N separate emails.
//
// Returns:
//   { sent: true,  providerId: string }  — Resend accepted; providerId is the message id.
//   { sent: false, providerId: null }    — RESEND_API_KEY missing, send rejected, or network threw.

export interface OverdueRiskRow {
  risk_number:       string
  title:             string
  effective_band:    'low' | 'moderate' | 'high' | 'extreme'
  next_review_date:  string                                  // YYYY-MM-DD
  /** Days since the review date passed; positive integer. */
  days_overdue:      number
  /** Public URL for the risk detail page (no token; the URL still
      requires sign-in — RLS scopes the read). */
  detail_url:        string
}

export interface RiskReviewReminderArgs {
  to:           string
  reviewerName: string
  tenantName:   string
  risks:        OverdueRiskRow[]
}

export async function sendRiskReviewReminder(
  args: RiskReviewReminderArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[risk-review-reminder] RESEND_API_KEY not set — skipping send')
    return { sent: false, providerId: null }
  }
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const subject = args.risks.length === 1
    ? `1 risk review is overdue — ${args.tenantName}`
    : `${args.risks.length} risk reviews are overdue — ${args.tenantName}`

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
      Sentry.captureException(error, { tags: { module: 'sendRiskReviewReminder', stage: 'resend' } })
      return { sent: false, providerId: null }
    }
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendRiskReviewReminder', stage: 'resend' } })
    return { sent: false, providerId: null }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────

function renderText(a: RiskReviewReminderArgs): string {
  const dispName = a.reviewerName?.trim() || a.to.split('@')[0] || 'there'
  const lines = a.risks.map(r =>
    `  • ${r.risk_number}  [${r.effective_band.toUpperCase()}]  ${r.days_overdue} days overdue (last review due ${r.next_review_date})\n    ${r.title}\n    ${r.detail_url}`
  ).join('\n\n')
  return `Hi ${dispName},

You have ${a.risks.length} risk review${a.risks.length === 1 ? '' : 's'} overdue in ${a.tenantName}.

${lines}

Per ISO 45001 9.1 + Cal/OSHA T8 §3203, risk reviews on cadence are
how the program demonstrates ongoing hazard evaluation. Reviewing
keeps the audit trail current — even a "no change" outcome
documents that you checked.

Open each risk above to record a review (Mark reviewed → notes →
submit). The next-review date will reset based on the band's
cadence.

— Soteria FIELD on behalf of ${a.tenantName}
`
}

function renderHtml(a: RiskReviewReminderArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const dispName = safe(a.reviewerName?.trim() || a.to.split('@')[0] || 'there')

  const BAND_HEX: Record<OverdueRiskRow['effective_band'], string> = {
    low:      '#16A34A',
    moderate: '#EAB308',
    high:     '#EA580C',
    extreme:  '#DC2626',
  }

  const rows = a.risks.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#5b6675;">
        ${safe(r.risk_number)}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;">
        <a href="${safe(r.detail_url)}" style="color:#1a2230;text-decoration:none;font-weight:600;">${safe(r.title)}</a>
        <div style="font-size:11px;color:#5b6675;margin-top:2px;">
          Last review due ${safe(r.next_review_date)} · ${r.days_overdue} days overdue
        </div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;text-align:right;">
        <span style="display:inline-block;padding:3px 8px;border-radius:6px;background:${BAND_HEX[r.effective_band]};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">
          ${safe(r.effective_band)}
        </span>
      </td>
    </tr>`).join('')

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">
        Soteria FIELD · Risk reviews
      </div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">
        ${a.risks.length} review${a.risks.length === 1 ? '' : 's'} overdue · ${safe(a.tenantName)}
      </div>
    </td></tr>
    <tr><td style="padding:22px 28px 4px 28px;">
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Hi ${dispName},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">
        These risks are past their scheduled review date. Per ISO 45001 9.1 + Cal/OSHA T8 §3203, even a "no change" review keeps the audit trail current.
      </p>
    </td></tr>
    <tr><td style="padding:0 28px 4px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>
    </td></tr>
    <tr><td style="padding:18px 28px 24px 28px;">
      <p style="margin:0;font-size:12px;line-height:1.55;color:#5b6675;">
        Open each risk → "Mark reviewed" → notes → submit. The next-review date resets based on the band's cadence (Extreme 90d · High 180d · Moderate annually · Low every 2 years).
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:14px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent on behalf of ${safe(a.tenantName)} · soteriafield.app
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
