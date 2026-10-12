import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import { unsubscribeFooterText, unsubscribeFooterHtml } from '@/lib/email/unsubscribe'

// Weekly environmental compliance reminder, sent by /api/cron/compliance-calendar-reminders.
// One email per (tenant, person), listing the deadlines that person is responsible for
// (or, for an admin, the ones nobody owns) that are overdue or inside their reminder window.

export interface ReminderEmailItem {
  title:         string
  regulatoryRef: string | null
  site:          string
  dueOn:         string
  days:          number
  overdue:       boolean
}

export interface ComplianceReminderArgs {
  to:             string
  recipientName:  string
  tenantName:     string
  items:          ReminderEmailItem[]
  calendarUrl:    string
  unsubscribeUrl?: string | null
}

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function renderSubject(a: Pick<ComplianceReminderArgs, 'items' | 'tenantName'>): string {
  const overdue = a.items.filter(i => i.overdue).length
  const soon = a.items.length - overdue
  const parts = [overdue ? `${overdue} overdue` : null, soon ? `${soon} due soon` : null].filter(Boolean)
  return `Environmental compliance: ${parts.join(', ')} — ${a.tenantName}`
}

const whenText = (i: ReminderEmailItem) =>
  i.overdue ? `OVERDUE by ${-i.days} day${-i.days === 1 ? '' : 's'} (was due ${i.dueOn})` : i.days === 0 ? `due today (${i.dueOn})` : `due in ${i.days} day${i.days === 1 ? '' : 's'} (${i.dueOn})`

export function renderText(a: ComplianceReminderArgs): string {
  const name = a.recipientName.trim() || a.to.split('@')[0] || 'there'
  const lines = a.items.map(i => `  • ${i.title}${i.regulatoryRef ? ` [${i.regulatoryRef}]` : ''} — ${i.site}: ${whenText(i)}`).join('\n')
  return `Hi ${name},

These environmental compliance deadlines in ${a.tenantName} need attention:

${lines}

Open the calendar to complete them, run the checklist, or reassign them:
${a.calendarUrl}

— SoteriaField on behalf of ${a.tenantName}
${a.unsubscribeUrl ? unsubscribeFooterText(a.unsubscribeUrl, 'reminder emails') : ''}`
}

export function renderHtml(a: ComplianceReminderArgs): string {
  const name = escapeHtml(a.recipientName.trim() || a.to.split('@')[0] || 'there')
  const rows = a.items.map(i => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;">
          <div style="font-weight:600;color:#1a2230;">${escapeHtml(i.title)}</div>
          <div style="font-size:11px;color:#5b6675;margin-top:2px;">${escapeHtml(i.site)}${i.regulatoryRef ? ` · ${escapeHtml(i.regulatoryRef)}` : ''}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;text-align:right;">
          <span style="display:inline-block;padding:3px 8px;border-radius:6px;background:${i.overdue ? '#DC2626' : '#EAB308'};color:#fff;font-size:11px;font-weight:700;">${escapeHtml(whenText(i))}</span>
        </td>
      </tr>`).join('')
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#fff;border-radius:14px;overflow:hidden;">
    <tr><td style="background:#214488;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Environmental compliance</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${a.items.length} deadline${a.items.length === 1 ? '' : 's'} need attention · ${escapeHtml(a.tenantName)}</div>
    </td></tr>
    <tr><td style="padding:22px 28px 8px 28px;"><p style="margin:0;font-size:15px;line-height:1.55;">Hi ${name}, these are overdue or coming due.</p></td></tr>
    <tr><td style="padding:0 28px 8px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">${rows}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px 24px 28px;">
      <a href="${escapeHtml(a.calendarUrl)}" style="display:inline-block;background:#214488;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;">Open the calendar</a>
    </td></tr>
  </table>
</td></tr>
</table>${a.unsubscribeUrl ? unsubscribeFooterHtml(a.unsubscribeUrl, 'reminder emails') : ''}
</body></html>`
}

export async function sendComplianceReminder(a: ComplianceReminderArgs): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[compliance-reminder] RESEND_API_KEY not set — skipping send')
    await logEmailSend({ kind: 'compliance-reminder', to: a.to, subject: undefined, status: 'skipped', errorText: 'RESEND_API_KEY not set' })
    return { sent: false, providerId: null }
  }
  const from = process.env.INVITE_FROM_EMAIL ?? process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'
  const subject = renderSubject(a)
  try {
    const headers = a.unsubscribeUrl ? { 'List-Unsubscribe': `<${a.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined
    const { data, error } = await new Resend(apiKey).emails.send({ from, to: a.to, subject, text: renderText(a), html: renderHtml(a), headers })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendComplianceReminder', stage: 'resend' } })
      await logEmailSend({ kind: 'compliance-reminder', to: a.to, subject, status: 'failed', errorText: error.message })
      return { sent: false, providerId: null }
    }
    await logEmailSend({ kind: 'compliance-reminder', to: a.to, subject, status: 'sent', providerId: data?.id ?? null })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendComplianceReminder', stage: 'resend' } })
    await logEmailSend({ kind: 'compliance-reminder', to: a.to, subject, status: 'failed', errorText: err instanceof Error ? err.message : String(err) })
    return { sent: false, providerId: null }
  }
}
