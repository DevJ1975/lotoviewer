// Incident alert email — fanned out to recipients resolved by the
// notification rules engine (packages/core/src/incidentNotificationRules.ts).
//
// Returns true on a clean send, false on any failure. The send/log/error
// plumbing (incl. the email_log row keyed by tenant + triggering user) lives
// in lib/email/core.ts; this file owns the alert content and the
// severity-tinted header.

import { sendEmail } from '@/lib/email/core'
import { renderEmailLayout, escapeHtml } from '@/lib/email/layout'
import {
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  type IncidentType,
  type IncidentSeverityActual,
} from '@soteria/core/incident'

export interface IncidentAlertArgs {
  to:                string
  /** Recipient's display name. Falls back to local-part of email. */
  recipientName?:    string | null
  reportNumber:      string
  incidentType:      IncidentType
  severityActual:    IncidentSeverityActual
  occurredAt:        string                  // ISO timestamp
  locationText:      string | null
  description:       string
  appUrl:            string                  // origin to build deep link
  incidentId:        string
  /** Tenant context — surfaces in subject + body so a recipient on
   *  multiple tenants can disambiguate. */
  tenantName?:       string | null
  tenantId?:         string | null
  /** Audit fields — passed through to email_log. */
  triggeredBy?:      string | null
  ruleName?:         string | null
}

export async function sendIncidentAlertEmail(args: IncidentAlertArgs): Promise<boolean> {
  const subject = buildSubject(args)
  const text = renderText(args)
  const html = renderHtml(args)

  const { sent } = await sendEmail({
    kind: 'incident-alert',
    to: args.to,
    subject, text, html,
    tenantId: args.tenantId ?? null,
    triggeredBy: args.triggeredBy ?? null,
  })
  return sent
}

function buildSubject(a: IncidentAlertArgs): string {
  const tenantSuffix = a.tenantName ? ` · ${a.tenantName}` : ''
  const sev = a.severityActual === 'none'
    ? INCIDENT_TYPE_LABEL[a.incidentType]
    : SEVERITY_ACTUAL_LABEL[a.severityActual]
  return `[${a.reportNumber}] ${sev} reported${tenantSuffix}`
}

function deepLink(a: IncidentAlertArgs): string {
  return `${a.appUrl.replace(/\/$/, '')}/incidents/${a.incidentId}`
}

function renderText(a: IncidentAlertArgs): string {
  const name = a.recipientName?.trim() || a.to.split('@')[0]!
  const sev = SEVERITY_ACTUAL_LABEL[a.severityActual]
  const type = INCIDENT_TYPE_LABEL[a.incidentType]
  const tenantLine = a.tenantName ? `\n  Tenant:    ${a.tenantName}` : ''
  const ruleLine = a.ruleName ? `\n\n(Notified per rule: ${a.ruleName})` : ''
  const location = a.locationText ? `\n  Location:  ${a.locationText}` : ''
  const description = a.description.length > 600
    ? a.description.slice(0, 600) + '…'
    : a.description
  return `Hi ${name},

A new incident has been reported on SoteriaField.

  Report #:  ${a.reportNumber}
  Type:      ${type}
  Severity:  ${sev}
  Occurred:  ${a.occurredAt}${location}${tenantLine}

Description:
${description}

Open the incident:
  ${deepLink(a)}

For high-severity events, please acknowledge by transitioning the
incident to "Investigating" in the app — this stops the escalation
timer that would otherwise page leadership.${ruleLine}

— SoteriaField
`
}

function renderHtml(a: IncidentAlertArgs): string {
  const safe = escapeHtml
  const name = a.recipientName?.trim() || a.to.split('@')[0]!
  const sev = SEVERITY_ACTUAL_LABEL[a.severityActual]
  const type = INCIDENT_TYPE_LABEL[a.incidentType]
  const link = deepLink(a)
  // Severity-tinted header bar — visual triage for an inbox glance.
  const headerBg = a.severityActual === 'fatality' || a.severityActual === 'catastrophic'
    ? '#9f1239'   // rose-800
    : a.severityActual === 'lost_time'
      ? '#c2410c' // orange-700
      : a.severityActual === 'medical'
        ? '#a16207' // amber-700
        : '#214488' // brand navy
  const description = a.description.length > 600
    ? safe(a.description.slice(0, 600)) + '…'
    : safe(a.description)
  const tenantBlock = a.tenantName
    ? `<div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Tenant</div>
       <div style="margin-top:2px;">${safe(a.tenantName)}</div>`
    : ''
  const locationBlock = a.locationText
    ? `<div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Location</div>
       <div style="margin-top:2px;">${safe(a.locationText)}</div>`
    : ''
  const ruleBlock = a.ruleName
    ? `<p style="margin:18px 0 0 0;font-size:11px;line-height:1.55;color:#94a3b8;">Notified per rule: ${safe(a.ruleName)}</p>`
    : ''

  return renderEmailLayout({
    headerBg,
    eyebrow: 'SoteriaField · Incident Alert',
    heading: `${safe(a.reportNumber)} — ${safe(sev)}`,
    footerHtml: 'Sent from SoteriaField',
    contentHtml: `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">A new incident has been reported.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">Type</div>
          <div style="margin-top:2px;">${safe(type)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Occurred</div>
          <div style="margin-top:2px;">${safe(a.occurredAt)}</div>
          ${locationBlock}
          ${tenantBlock}
        </td></tr>
      </table>
      <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:18px;">Description</div>
      <div style="margin-top:6px;font-size:14px;line-height:1.55;white-space:pre-wrap;">${description}</div>
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:${headerBg};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open incident →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        For high-severity events, please acknowledge by transitioning the incident to <strong>Investigating</strong> in the app — this stops the escalation timer that would otherwise page leadership.
      </p>
      ${ruleBlock}`,
  })
}
