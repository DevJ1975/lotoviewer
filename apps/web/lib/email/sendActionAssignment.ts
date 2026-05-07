// CAPA assignment email — fires when a new action is created with a
// user as the owner. Mirrors sendIncidentAlert's posture (boolean
// return, never throws, logs every send via instrument.ts).

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import {
  ACTION_TYPE_LABEL,
  HIERARCHY_LABEL,
  type IncidentActionType,
  type HierarchyOfControls,
} from '@soteria/core/incidentAction'

export interface ActionAssignmentArgs {
  to:             string
  recipientName?: string | null
  reportNumber:   string
  incidentId:     string
  actionId:       string
  description:    string
  actionType:     IncidentActionType
  hierarchy:      HierarchyOfControls | null
  dueAt:          string | null
  appUrl:         string
  tenantName?:    string | null
  tenantId?:      string | null
  triggeredBy?:   string | null
}

export async function sendActionAssignmentEmail(args: ActionAssignmentArgs): Promise<boolean> {
  const apiKey  = process.env.RESEND_API_KEY
  const subject = `[${args.reportNumber}] ${ACTION_TYPE_LABEL[args.actionType]} action assigned to you`
  const tenantId = args.tenantId ?? null
  const triggeredBy = args.triggeredBy ?? null

  if (!apiKey) {
    await logEmailSend({
      kind: 'incident-action-assignment', to: args.to, subject,
      tenantId, triggeredBy, status: 'skipped',
      errorText: 'RESEND_API_KEY not set',
    })
    return false
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const link = `${args.appUrl.replace(/\/$/, '')}/incidents/${args.incidentId}/actions`
  const dueLine = args.dueAt
    ? `Due: ${new Date(args.dueAt).toLocaleString()}`
    : 'No deadline set'
  const hier = args.hierarchy ? HIERARCHY_LABEL[args.hierarchy] : '—'
  const name = args.recipientName?.trim() || args.to.split('@')[0]!
  const tenantSuffix = args.tenantName ? ` · ${args.tenantName}` : ''

  const text = `Hi ${name},

You've been assigned a ${ACTION_TYPE_LABEL[args.actionType].toLowerCase()} action on incident ${args.reportNumber}${tenantSuffix}.

  Action:    ${args.description}
  Control:   ${hier}
  ${dueLine}

Open the action:
  ${link}

When the work is done, mark the action Complete. A different team member
will verify it (separation of duty).

— Soteria FIELD
`

  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD · Action assigned</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${safe(args.reportNumber)} — ${safe(ACTION_TYPE_LABEL[args.actionType])}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">You've been assigned an action on this incident.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">Action</div>
          <div style="margin-top:2px;white-space:pre-wrap;">${safe(args.description)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Control</div>
          <div style="margin-top:2px;">${safe(hier)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Due</div>
          <div style="margin-top:2px;">${safe(args.dueAt ? new Date(args.dueAt).toLocaleString() : 'No deadline')}</div>
        </td></tr>
      </table>
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:#214488;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open action →</a>
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        When the work is done, mark the action <strong>Complete</strong>. A different team member will verify it (separation of duty).
      </p>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendActionAssignment', stage: 'resend' } })
      await logEmailSend({
        kind: 'incident-action-assignment', to: args.to, subject,
        tenantId, triggeredBy, status: 'failed', errorText: error.message,
      })
      return false
    }
    await logEmailSend({
      kind: 'incident-action-assignment', to: args.to, subject,
      tenantId, triggeredBy, status: 'sent', providerId: data?.id ?? null,
    })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendActionAssignment' } })
    await logEmailSend({
      kind: 'incident-action-assignment', to: args.to, subject,
      tenantId, triggeredBy, status: 'failed',
      errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
