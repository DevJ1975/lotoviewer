// Investigation-SLA reminder email — fires when a high-severity
// incident has not been moved to status='investigating' (or further)
// within the SLA window from its notification rule's
// escalation_minutes.
//
// Posture matches sendIncidentAlert.ts: returns boolean, never throws.
// Recipients are owners + admins of the tenant (the SLA cron picks
// the audience).

import { sendEmail } from '@/lib/email/core'
import {
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  type IncidentType,
  type IncidentSeverityActual,
} from '@soteria/core/incident'

export interface InvestigationDueArgs {
  to:               string
  recipientName?:   string | null
  reportNumber:     string
  incidentType:     IncidentType
  severityActual:   IncidentSeverityActual
  occurredAt:       string
  reportedAt:       string
  /** Hours since reported_at — surfaced verbatim so leadership sees
   *  exactly how late we are. */
  hoursOverdue:     number
  appUrl:           string
  incidentId:       string
  tenantName?:      string | null
  tenantId?:        string | null
}

export async function sendInvestigationDueReminder(args: InvestigationDueArgs): Promise<boolean> {
  const subject = `[ESCALATION] ${args.reportNumber} — investigation overdue (${args.hoursOverdue}h)`
  const tenantId = args.tenantId ?? null

  const text = renderText(args)
  const html = renderHtml(args)

  const { sent } = await sendEmail({
    kind: 'incident-investigation-due',
    to: args.to,
    subject, text, html,
    tenantId,
  })
  return sent
}

function deepLink(a: InvestigationDueArgs): string {
  return `${a.appUrl.replace(/\/$/, '')}/incidents/${a.incidentId}`
}

function renderText(a: InvestigationDueArgs): string {
  const name = a.recipientName?.trim() || a.to.split('@')[0]!
  const tenantLine = a.tenantName ? `\n  Tenant:    ${a.tenantName}` : ''
  return `Hi ${name},

Incident ${a.reportNumber} hasn't been investigated yet. The
SLA window has elapsed by ${a.hoursOverdue} hour(s).

  Type:      ${INCIDENT_TYPE_LABEL[a.incidentType]}
  Severity:  ${SEVERITY_ACTUAL_LABEL[a.severityActual]}
  Occurred:  ${a.occurredAt}
  Reported:  ${a.reportedAt}${tenantLine}

Please open the incident, assign an investigator, and transition
the status to "Investigating" — that stops further escalation.

  ${deepLink(a)}

— SoteriaField
`
}

function renderHtml(a: InvestigationDueArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const name = a.recipientName?.trim() || a.to.split('@')[0]!
  const link = deepLink(a)
  const tenantBlock = a.tenantName
    ? `<div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Tenant</div>
       <div style="margin-top:2px;">${safe(a.tenantName)}</div>`
    : ''
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#9f1239;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Escalation</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${safe(a.reportNumber)} — investigation overdue</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">This incident hasn't been investigated yet. The SLA window has elapsed by <strong>${a.hoursOverdue} hour(s)</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">Type</div>
          <div style="margin-top:2px;">${safe(INCIDENT_TYPE_LABEL[a.incidentType])}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Severity</div>
          <div style="margin-top:2px;">${safe(SEVERITY_ACTUAL_LABEL[a.severityActual])}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Occurred</div>
          <div style="margin-top:2px;">${safe(a.occurredAt)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Reported</div>
          <div style="margin-top:2px;">${safe(a.reportedAt)}</div>
          ${tenantBlock}
        </td></tr>
      </table>
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:#9f1239;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open incident →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Move the incident to <strong>Investigating</strong> to stop further escalation reminders.
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from SoteriaField
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
