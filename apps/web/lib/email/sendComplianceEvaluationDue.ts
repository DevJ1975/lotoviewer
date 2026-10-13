import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import { unsubscribeFooterHtml, unsubscribeFooterText } from '@/lib/email/unsubscribe'

// "Compliance evaluations to complete" email.
//
// Sent by /api/cron/compliance-evaluations when it schedules evaluations:
// one email per (tenant, recipient), listing every evaluation scheduled for
// them in that run. The recipient is the obligation's owner, or the
// tenant's owners and admins when the obligation has none. Same shape and
// suppression category ('reminders') as the training-expiry reminder.
//
// Returns:
//   { sent: true,  providerId: string }  Resend accepted; providerId is the message id.
//   { sent: false, providerId: null }    RESEND_API_KEY missing, send rejected, or network threw.

export interface DueEvaluationRow {
  obligationTitle: string
  /** ISO calendar date the evaluation is due. */
  scheduledFor:    string
  /** Public URL of the obligation in the register (sign-in required; RLS scopes the read). */
  url:             string
}

export interface ComplianceEvaluationDueArgs {
  to:              string
  recipientName:   string
  tenantName:      string
  evaluations:     DueEvaluationRow[]
  /** RFC 8058 unsubscribe URL. When set, adds the List-Unsubscribe headers and a footer link. */
  unsubscribeUrl?: string | null
}

const KIND = 'compliance-evaluation-due'

export async function sendComplianceEvaluationDue(
  args: ComplianceEvaluationDueArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[compliance-evaluation-due] RESEND_API_KEY not set — skipping send')
    await logEmailSend({ kind: KIND, to: args.to, status: 'skipped', errorText: 'RESEND_API_KEY not set' })
    return { sent: false, providerId: null }
  }
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const count = args.evaluations.length
  const subject = `${count} compliance evaluation${count === 1 ? '' : 's'} to complete — ${args.tenantName}`

  try {
    const resend = new Resend(apiKey)
    const headers = args.unsubscribeUrl
      ? { 'List-Unsubscribe': `<${args.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined
    const { data, error } = await resend.emails.send({
      from, to: args.to, subject, text: renderText(args), html: renderHtml(args), headers,
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendComplianceEvaluationDue', stage: 'resend' } })
      await logEmailSend({ kind: KIND, to: args.to, subject, status: 'failed', errorText: error.message })
      return { sent: false, providerId: null }
    }
    await logEmailSend({ kind: KIND, to: args.to, subject, status: 'sent', providerId: data?.id ?? null })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendComplianceEvaluationDue', stage: 'resend' } })
    await logEmailSend({
      kind: KIND, to: args.to, subject, status: 'failed', errorText: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, providerId: null }
  }
}

// ── Rendering ──────────────────────────────────────────────────────────

const WHY = 'ISO 14001 clause 9.1.2 asks for compliance with each obligation to be evaluated, '
  + 'and for the result to be kept as evidence. Attach what you checked, then record the result.'

function displayName(a: ComplianceEvaluationDueArgs): string {
  return a.recipientName.trim() || a.to.split('@')[0] || 'there'
}

export function renderText(a: ComplianceEvaluationDueArgs): string {
  const lines = a.evaluations
    .map(e => `  • ${e.obligationTitle}\n    Due ${e.scheduledFor} · ${e.url}`)
    .join('\n\n')
  return `Hi ${displayName(a)},

These compliance evaluations in ${a.tenantName} are ready for you:

${lines}

${WHY}

— SoteriaField on behalf of ${a.tenantName}
${a.unsubscribeUrl ? unsubscribeFooterText(a.unsubscribeUrl, 'reminder emails') : ''}`
}

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function renderHtml(a: ComplianceEvaluationDueArgs): string {
  const rows = a.evaluations.map(e => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;">
        <a href="${escapeHtml(e.url)}" style="color:#1a2230;text-decoration:none;font-weight:600;">${escapeHtml(e.obligationTitle)}</a>
        <div style="font-size:11px;color:#5b6675;margin-top:2px;">Due ${escapeHtml(e.scheduledFor)}</div>
      </td>
    </tr>`).join('')
  const count = a.evaluations.length

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Compliance evaluations</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${count} to complete · ${escapeHtml(a.tenantName)}</div>
    </td></tr>
    <tr><td style="padding:22px 28px 4px 28px;">
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Hi ${escapeHtml(displayName(a))},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">${escapeHtml(WHY)}</p>
    </td></tr>
    <tr><td style="padding:0 28px 20px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>
      ${a.unsubscribeUrl ? unsubscribeFooterHtml(a.unsubscribeUrl, 'reminder emails') : ''}
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:14px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent on behalf of ${escapeHtml(a.tenantName)} · soteriafield.app
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
