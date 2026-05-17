import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import type { DigestRow } from '@soteria/core/trainingExpiryDigest'

// Daily training-expiry reminder email.
//
// Sent by /api/cron/training-expiry-reminders to tenant admins.
// One email per (tenant, admin) pair, with all expiring/expired
// training rows for that tenant listed inline. Same shape as the
// risk-review reminder so the operator can rate-limit at the
// Resend level if both crons fire together.
//
// Returns:
//   { sent: true,  providerId: string }  — Resend accepted; providerId is the message id.
//   { sent: false, providerId: null }    — RESEND_API_KEY missing, send rejected, or network threw.

export interface TrainingExpiryReminderArgs {
  to:           string
  reviewerName: string
  tenantName:   string
  rows:         DigestRow[]
  /** Public URL for /admin/loto/training-records (RLS scopes the read). */
  trainingUrl:  string
  /** Public URL for /admin/people/workers (RLS scopes the read). */
  workersUrl:   string
}

export async function sendTrainingExpiryReminder(
  args: TrainingExpiryReminderArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[training-expiry-reminder] RESEND_API_KEY not set — skipping send')
    await logEmailSend({
      kind: 'training-expiry', to: args.to, subject: undefined,
      status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return { sent: false, providerId: null }
  }
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const expired = args.rows.filter(r => r.status === 'expired').length
  const expiring = args.rows.length - expired

  const subjectParts: string[] = []
  if (expired)  subjectParts.push(`${expired} expired`)
  if (expiring) subjectParts.push(`${expiring} expiring`)
  const subject = `Training: ${subjectParts.join(', ')} — ${args.tenantName}`

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
      Sentry.captureException(error, { tags: { module: 'sendTrainingExpiryReminder', stage: 'resend' } })
      await logEmailSend({
        kind: 'training-expiry', to: args.to, subject,
        status: 'failed', errorText: error.message,
      })
      return { sent: false, providerId: null }
    }
    await logEmailSend({
      kind: 'training-expiry', to: args.to, subject,
      status: 'sent', providerId: data?.id ?? null,
    })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendTrainingExpiryReminder', stage: 'resend' } })
    await logEmailSend({
      kind: 'training-expiry', to: args.to, subject,
      status: 'failed', errorText: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, providerId: null }
  }
}

// ── Rendering ──────────────────────────────────────────────────────────
function renderText(a: TrainingExpiryReminderArgs): string {
  const dispName = a.reviewerName?.trim() || a.to.split('@')[0] || 'there'
  const lines = a.rows.map(r =>
    r.status === 'expired'
      ? `  • ${r.worker_name}  [${r.role_label}]  EXPIRED ${r.days}d ago (${r.expires_on})`
      : `  • ${r.worker_name}  [${r.role_label}]  expires in ${r.days}d (${r.expires_on})`,
  ).join('\n')

  return `Hi ${dispName},

The following training certifications need attention in ${a.tenantName}:

${lines}

LOTO §1910.147(c)(7) and CS §1910.146(g) require workers to hold
current certifications before being issued a locktag or named on
an entry permit. Workers with expired training are blocked from
both flows automatically — renewing them keeps work moving.

Update training records:  ${a.trainingUrl}
Worker roster:            ${a.workersUrl}

— SoteriaField on behalf of ${a.tenantName}
`
}

function renderHtml(a: TrainingExpiryReminderArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const dispName = safe(a.reviewerName?.trim() || a.to.split('@')[0] || 'there')

  const expiredRows  = a.rows.filter(r => r.status === 'expired')
  const expiringRows = a.rows.filter(r => r.status === 'expiring')

  function rowHtml(r: DigestRow): string {
    const statusBg = r.status === 'expired' ? '#DC2626' : '#EAB308'
    const statusLabel = r.status === 'expired'
      ? `EXPIRED ${r.days}d`
      : `${r.days}d remaining`
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;">
          <div style="font-weight:600;color:#1a2230;">${safe(r.worker_name)}</div>
          <div style="font-size:11px;color:#5b6675;margin-top:2px;">
            ${safe(r.role_label)} · expires ${safe(r.expires_on)}
          </div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;text-align:right;">
          <span style="display:inline-block;padding:3px 8px;border-radius:6px;background:${statusBg};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">
            ${safe(statusLabel)}
          </span>
        </td>
      </tr>`
  }

  const expiredSection = expiredRows.length === 0 ? '' : `
    <tr><td style="padding:18px 28px 6px 28px;">
      <div style="font-size:12px;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:0.06em;">Expired (${expiredRows.length})</div>
    </td></tr>
    <tr><td style="padding:0 28px 4px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">
        ${expiredRows.map(rowHtml).join('')}
      </table>
    </td></tr>`

  const expiringSection = expiringRows.length === 0 ? '' : `
    <tr><td style="padding:18px 28px 6px 28px;">
      <div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.06em;">Expiring soon (${expiringRows.length})</div>
    </td></tr>
    <tr><td style="padding:0 28px 4px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">
        ${expiringRows.map(rowHtml).join('')}
      </table>
    </td></tr>`

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">
        SoteriaField · Training expiry
      </div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">
        ${a.rows.length} certification${a.rows.length === 1 ? '' : 's'} need attention · ${safe(a.tenantName)}
      </div>
    </td></tr>
    <tr><td style="padding:22px 28px 4px 28px;">
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Hi ${dispName},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">
        Workers with expired LOTO or CS training are blocked from being issued a locktag or named on an entry permit until their cert is renewed. Below is the list that needs renewal.
      </p>
    </td></tr>
    ${expiredSection}
    ${expiringSection}
    <tr><td style="padding:18px 28px 24px 28px;">
      <a href="${safe(a.trainingUrl)}" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;margin-right:8px;">Update training records</a>
      <a href="${safe(a.workersUrl)}" style="display:inline-block;background:#ffffff;color:#214488;border:1px solid #214488;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;">Worker roster</a>
    </td></tr>
    <tr><td style="padding:0 28px 28px 28px;">
      <p style="margin:0;font-size:11px;color:#5b6675;line-height:1.5;">
        29 CFR 1910.147(c)(7) and 29 CFR 1910.146(g) require workers to hold current certifications before being issued a locktag or named on an entry permit. The app blocks both flows automatically when a cert is missing or expired.
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
