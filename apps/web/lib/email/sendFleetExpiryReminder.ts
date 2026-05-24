import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import { unsubscribeFooterText, unsubscribeFooterHtml } from '@/lib/email/unsubscribe'
import type { DigestRow } from '@soteria/core/fleetExpiry'

// Daily fleet credential/document expiry reminder email.
//
// Sent by /api/cron/fleet-document-expiry-reminders to tenant admins. One
// email per (tenant, admin) pair, listing expiring/expired driver licenses,
// DOT medical cards, hazmat endorsements, and vehicle documents.

export interface FleetExpiryReminderArgs {
  to:           string
  reviewerName: string
  tenantName:   string
  rows:         DigestRow[]
  vehiclesUrl:  string
  driversUrl:   string
  unsubscribeUrl?: string | null
}

export async function sendFleetExpiryReminder(
  args: FleetExpiryReminderArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[fleet-expiry-reminder] RESEND_API_KEY not set — skipping send')
    await logEmailSend({ kind: 'fleet-expiry', to: args.to, subject: undefined, status: 'skipped', errorText: 'RESEND_API_KEY not set' })
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
  const subject = `Fleet: ${subjectParts.join(', ')} — ${args.tenantName}`

  try {
    const resend = new Resend(apiKey)
    const headers = args.unsubscribeUrl
      ? { 'List-Unsubscribe': `<${args.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined
    const { data, error } = await resend.emails.send({
      from, to: args.to, subject,
      text: renderText(args), html: renderHtml(args), headers,
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendFleetExpiryReminder', stage: 'resend' } })
      await logEmailSend({ kind: 'fleet-expiry', to: args.to, subject, status: 'failed', errorText: error.message })
      return { sent: false, providerId: null }
    }
    await logEmailSend({ kind: 'fleet-expiry', to: args.to, subject, status: 'sent', providerId: data?.id ?? null })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendFleetExpiryReminder', stage: 'resend' } })
    await logEmailSend({ kind: 'fleet-expiry', to: args.to, subject, status: 'failed', errorText: err instanceof Error ? err.message : String(err) })
    return { sent: false, providerId: null }
  }
}

function renderText(a: FleetExpiryReminderArgs): string {
  const dispName = a.reviewerName?.trim() || a.to.split('@')[0] || 'there'
  const lines = a.rows.map(r =>
    r.status === 'expired'
      ? `  • ${r.subject}  [${r.kind_label}]  EXPIRED ${r.days}d ago (${r.expires_on})`
      : `  • ${r.subject}  [${r.kind_label}]  expires in ${r.days}d (${r.expires_on})`,
  ).join('\n')

  return `Hi ${dispName},

The following fleet credentials and documents need attention in ${a.tenantName}:

${lines}

Drivers with an expired license, DOT medical card, or hazmat endorsement —
and vehicles with lapsed insurance, registration, or annual DOT inspection —
should be taken out of service until renewed.

Vehicles: ${a.vehiclesUrl}
Drivers:  ${a.driversUrl}

— SoteriaField on behalf of ${a.tenantName}
${a.unsubscribeUrl ? unsubscribeFooterText(a.unsubscribeUrl, 'reminder emails') : ''}`
}

function renderHtml(a: FleetExpiryReminderArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const dispName = safe(a.reviewerName?.trim() || a.to.split('@')[0] || 'there')

  const expiredRows  = a.rows.filter(r => r.status === 'expired')
  const expiringRows = a.rows.filter(r => r.status === 'expiring')

  function rowHtml(r: DigestRow): string {
    const statusBg = r.status === 'expired' ? '#DC2626' : '#EAB308'
    const statusLabel = r.status === 'expired' ? `EXPIRED ${r.days}d` : `${r.days}d remaining`
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;">
          <div style="font-weight:600;color:#1a2230;">${safe(r.subject)}</div>
          <div style="font-size:11px;color:#5b6675;margin-top:2px;">${safe(r.kind_label)} · expires ${safe(r.expires_on)}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;text-align:right;">
          <span style="display:inline-block;padding:3px 8px;border-radius:6px;background:${statusBg};color:#fff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${safe(statusLabel)}</span>
        </td>
      </tr>`
  }

  const section = (label: string, color: string, rows: DigestRow[]) => rows.length === 0 ? '' : `
    <tr><td style="padding:18px 28px 6px 28px;">
      <div style="font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;">${label} (${rows.length})</div>
    </td></tr>
    <tr><td style="padding:0 28px 4px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">
        ${rows.map(rowHtml).join('')}
      </table>
    </td></tr>`

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Fleet expiry</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${a.rows.length} item${a.rows.length === 1 ? '' : 's'} need attention · ${safe(a.tenantName)}</div>
    </td></tr>
    <tr><td style="padding:22px 28px 4px 28px;">
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Hi ${dispName},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">Driver credentials and vehicle documents below are expiring or expired. Renew them to keep the affected drivers and vehicles in service.</p>
    </td></tr>
    ${section('Expired', '#DC2626', expiredRows)}
    ${section('Expiring soon', '#92400e', expiringRows)}
    <tr><td style="padding:18px 28px 24px 28px;">
      <a href="${safe(a.vehiclesUrl)}" style="display:inline-block;background:#214488;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;margin-right:8px;">Vehicles</a>
      <a href="${safe(a.driversUrl)}" style="display:inline-block;background:#fff;color:#214488;border:1px solid #214488;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;">Drivers</a>
    </td></tr>
  </table>
</td></tr>
</table>${a.unsubscribeUrl ? unsubscribeFooterHtml(a.unsubscribeUrl, 'reminder emails') : ''}
</body></html>`
}
