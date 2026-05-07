// CAPA reminder email — fired by the daily incident-action-reminders
// cron when a CAPA is overdue (due_at < now, status open/in_progress/
// blocked) or coming up in ≤3 days. Same posture as the other helpers.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import {
  ACTION_TYPE_LABEL,
  type IncidentActionType,
} from '@soteria/core/incidentAction'

export interface ActionReminderArgs {
  to:             string
  recipientName?: string | null
  reportNumber:   string
  incidentId:     string
  actionId:       string
  description:    string
  actionType:     IncidentActionType
  dueAt:          string                       // ISO; non-null at this point
  /** Negative = days remaining; positive = days overdue. */
  daysOverdue:    number
  appUrl:         string
  tenantName?:    string | null
  tenantId?:      string | null
}

export async function sendActionReminderEmail(args: ActionReminderArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const overdue = args.daysOverdue > 0
  const subject = overdue
    ? `[OVERDUE ${args.daysOverdue}d] ${args.reportNumber} — ${ACTION_TYPE_LABEL[args.actionType]} action`
    : `[DUE SOON] ${args.reportNumber} — ${ACTION_TYPE_LABEL[args.actionType]} action`
  const tenantId = args.tenantId ?? null

  if (!apiKey) {
    await logEmailSend({
      kind: 'incident-action-reminder', to: args.to, subject,
      tenantId, status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return false
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const link = `${args.appUrl.replace(/\/$/, '')}/incidents/${args.incidentId}/actions`
  const name = args.recipientName?.trim() || args.to.split('@')[0]!
  const headerBg = overdue ? '#9f1239' : '#a16207'
  const dueLabel = overdue
    ? `Was due ${args.daysOverdue} day${args.daysOverdue === 1 ? '' : 's'} ago`
    : `Due in ${Math.abs(args.daysOverdue)} day${Math.abs(args.daysOverdue) === 1 ? '' : 's'}`

  const text = `Hi ${name},

${dueLabel}: ${ACTION_TYPE_LABEL[args.actionType]} action on incident ${args.reportNumber}.

  ${args.description}

  Due: ${new Date(args.dueAt).toLocaleString()}

Open the action:
  ${link}

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
    <tr><td style="background:${headerBg};padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD · Action ${overdue ? 'overdue' : 'due soon'}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${safe(args.reportNumber)} — ${safe(ACTION_TYPE_LABEL[args.actionType])}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;"><strong>${safe(dueLabel)}.</strong></p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">Action</div>
          <div style="margin-top:2px;white-space:pre-wrap;">${safe(args.description)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;">Due</div>
          <div style="margin-top:2px;">${safe(new Date(args.dueAt).toLocaleString())}</div>
        </td></tr>
      </table>
      <p style="margin:24px 0 0 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:${headerBg};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open action →</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendActionReminder', stage: 'resend' } })
      await logEmailSend({
        kind: 'incident-action-reminder', to: args.to, subject,
        tenantId, status: 'failed', errorText: error.message,
      })
      return false
    }
    await logEmailSend({
      kind: 'incident-action-reminder', to: args.to, subject,
      tenantId, status: 'sent', providerId: data?.id ?? null,
    })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendActionReminder' } })
    await logEmailSend({
      kind: 'incident-action-reminder', to: args.to, subject,
      tenantId, status: 'failed',
      errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
