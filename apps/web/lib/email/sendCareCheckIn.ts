// Care follow-up reminder — fired by the daily incident-care-followup
// cron when a care case has next_followup_at on or before today and
// case_status is still active.

import { sendEmail } from '@/lib/email/core'
import { unsubscribeFooterText, unsubscribeFooterHtml } from '@/lib/email/unsubscribe'
import {
  CARE_CASE_STATUS_LABEL,
  type CareCaseStatus,
} from '@soteria/core/incidentCare'

export interface CareCheckInArgs {
  to:             string
  recipientName?: string | null
  reportNumber:   string
  incidentId:     string
  caseId:         string
  caseStatus:     CareCaseStatus
  injuredName?:   string | null
  daysOpen:       number
  appUrl:         string
  tenantName?:    string | null
  tenantId?:      string | null
  /** RFC 8058 unsubscribe URL. When set, adds the List-Unsubscribe headers
   *  and a footer link; omit it and the email goes out unchanged. */
  unsubscribeUrl?: string | null
}

export async function sendCareCheckInEmail(args: CareCheckInArgs): Promise<boolean> {
  const subject = `[${args.reportNumber}] Care case follow-up due`
  const tenantId = args.tenantId ?? null

  const link = `${args.appUrl.replace(/\/$/, '')}/incidents/${args.incidentId}/care`
  const name = args.recipientName?.trim() || args.to.split('@')[0]!
  const personLine = args.injuredName ? ` for ${args.injuredName}` : ''

  const text = `Hi ${name},

A care case follow-up is due${personLine} on incident ${args.reportNumber}.

  Status:  ${CARE_CASE_STATUS_LABEL[args.caseStatus]}
  Open:    ${args.daysOpen} day(s)

Reach out, log a visit, and update restrictions / RTW status:
  ${link}

— SoteriaField
${args.unsubscribeUrl ? unsubscribeFooterText(args.unsubscribeUrl, 'reminder emails') : ''}`

  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#0f766e;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Care follow-up</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${safe(args.reportNumber)}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Care case follow-up is due${args.injuredName ? ` for <strong>${safe(args.injuredName)}</strong>` : ''}.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">Status</div>
          <div style="margin-top:2px;">${safe(CARE_CASE_STATUS_LABEL[args.caseStatus])}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Days open</div>
          <div style="margin-top:2px;">${args.daysOpen}</div>
        </td></tr>
      </table>
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open care case →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Reach out, log a visit, and update restrictions / RTW status to push the next follow-up date forward.
      </p>${args.unsubscribeUrl ? unsubscribeFooterHtml(args.unsubscribeUrl, 'reminder emails') : ''}
    </td></tr>
  </table>
</td></tr>
</table></body></html>`

  const { sent } = await sendEmail({
    kind: 'incident-care-followup',
    to: args.to,
    subject, text, html,
    tenantId,
    unsubscribeUrl: args.unsubscribeUrl ?? null,
  })
  return sent
}
