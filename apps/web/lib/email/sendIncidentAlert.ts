// Incident alert email — fanned out to recipients resolved by the
// notification rules engine (packages/core/src/incidentNotificationRules.ts).
//
// Returns true on a clean send, false on any failure (skip / Resend
// reject / network throw). Failures are Sentry-logged + email_log
// rows are written via instrument.ts so the per-incident
// notifications tab + the superadmin dashboard see the trail.
//
// Mirrors sendInviteEmail's posture: no exceptions bubble out, the
// boolean drives the fan-out caller's loop.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
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
  const apiKey = process.env.RESEND_API_KEY
  const subject = buildSubject(args)
  const tenantId = args.tenantId ?? null
  const triggeredBy = args.triggeredBy ?? null

  if (!apiKey) {
    console.warn('[incident-alert] RESEND_API_KEY not set — skipping send')
    await logEmailSend({
      kind: 'incident-alert', to: args.to, subject,
      tenantId, triggeredBy,
      status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return false
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const text = renderText(args)
  const html = renderHtml(args)

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendIncidentAlertEmail', stage: 'resend' } })
      console.error('[incident-alert] Resend rejected the send', error)
      await logEmailSend({
        kind: 'incident-alert', to: args.to, subject,
        tenantId, triggeredBy,
        status: 'failed', errorText: error.message,
      })
      return false
    }
    await logEmailSend({
      kind: 'incident-alert', to: args.to, subject,
      tenantId, triggeredBy,
      status: 'sent', providerId: data?.id ?? null,
    })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendIncidentAlertEmail', stage: 'resend' } })
    console.error('[incident-alert] send threw', err)
    await logEmailSend({
      kind: 'incident-alert', to: args.to, subject,
      tenantId, triggeredBy,
      status: 'failed', errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
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

A new incident has been reported on Soteria FIELD.

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

— Soteria FIELD
`
}

function renderHtml(a: IncidentAlertArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:${headerBg};padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD · Incident Alert</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${safe(a.reportNumber)} — ${safe(sev)}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
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
      ${ruleBlock}
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from Soteria FIELD
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
