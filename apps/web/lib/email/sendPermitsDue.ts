import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import { unsubscribeFooterHtml, unsubscribeFooterText } from '@/lib/email/unsubscribe'

// "Permits and permit conditions that need attention" email.
//
// Sent by /api/cron/environmental-permits: one email per (tenant, recipient),
// listing every renewal notice and condition reminder owed to them in that
// run. The recipients (Phase 2 plan D8, D9) are the permit's or condition's
// owner while they are still a member, otherwise the tenant's owners and
// admins; a business-critical permit also reaches the holder of Compliance
// obligations, and reaches every owner and admin at 30 days and once past its
// deadline. Same shape and suppression category ('reminders') as the
// compliance-evaluation reminder.
//
// Returns:
//   { sent: true,  providerId: string }  Resend accepted; providerId is the message id.
//   { sent: false, providerId: null }    RESEND_API_KEY missing, send rejected, or network threw.

export type RenewalTierLabel = 180 | 90 | 30 | 'passed'

export interface RenewalLine {
  permitTitle:       string
  agency:            string
  permitNumber:      string | null
  /** Where the countdown runs to: the renewal application date, or the expiry date. */
  deadline:          string
  /** Whether that deadline is the application's (the permit lapses later), not the expiry itself. */
  isApplicationDate: boolean
  tier:              RenewalTierLabel
  daysLeft:          number
  businessCritical:  boolean
  /** Public URL of the permit in the vault (sign-in required; RLS scopes the read). */
  url:               string
}

export interface ConditionLine {
  conditionTitle: string
  permitTitle:    string
  /** ISO calendar date the condition is due. */
  dueOn:          string
  stage:          'due_soon' | 'overdue'
  url:            string
}

export interface PermitsDueArgs {
  to:              string
  recipientName:   string
  tenantName:      string
  renewals:        RenewalLine[]
  conditions:      ConditionLine[]
  /** RFC 8058 unsubscribe URL. When set, adds the List-Unsubscribe headers and a footer link. */
  unsubscribeUrl?: string | null
}

const KIND = 'permits-due'

export async function sendPermitsDue(args: PermitsDueArgs): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[permits-due] RESEND_API_KEY not set — skipping send')
    await logEmailSend({ kind: KIND, to: args.to, status: 'skipped', errorText: 'RESEND_API_KEY not set' })
    return { sent: false, providerId: null }
  }
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const subject = subjectFor(args)
  try {
    const resend = new Resend(apiKey)
    const headers = args.unsubscribeUrl
      ? { 'List-Unsubscribe': `<${args.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined
    const { data, error } = await resend.emails.send({
      from, to: args.to, subject, text: renderText(args), html: renderHtml(args), headers,
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendPermitsDue', stage: 'resend' } })
      await logEmailSend({ kind: KIND, to: args.to, subject, status: 'failed', errorText: error.message })
      return { sent: false, providerId: null }
    }
    await logEmailSend({ kind: KIND, to: args.to, subject, status: 'sent', providerId: data?.id ?? null })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendPermitsDue', stage: 'resend' } })
    await logEmailSend({
      kind: KIND, to: args.to, subject, status: 'failed', errorText: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, providerId: null }
  }
}

// ── Rendering ──────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function subjectFor(a: PermitsDueArgs): string {
  const parts = [
    ...(a.renewals.length > 0 ? [plural(a.renewals.length, 'permit renewal', 'permit renewals')] : []),
    ...(a.conditions.length > 0 ? [plural(a.conditions.length, 'permit condition', 'permit conditions')] : []),
  ]
  // "1 permit renewal needs attention", but "2 permit renewals need attention" and "1 … and 1 … need attention".
  const verb = parts.length === 1 && a.renewals.length + a.conditions.length === 1 ? 'needs' : 'need'
  return `${parts.join(' and ')} ${verb} attention — ${a.tenantName}`
}

/** One line a person reads: how far off the deadline is, and what it is the deadline for. */
export function renewalWording(line: RenewalLine): string {
  const what = line.isApplicationDate ? 'The renewal application is due' : 'The permit expires'
  if (line.tier === 'passed') {
    const days = Math.abs(line.daysLeft)
    return `${what} on ${line.deadline}, ${plural(days, 'day', 'days')} ago. Confirm its status with the agency.`
  }
  const when = line.daysLeft === 0 ? 'today' : `in ${plural(line.daysLeft, 'day', 'days')} (${line.deadline})`
  return `${what} ${when}.`
}

export function conditionWording(line: ConditionLine): string {
  return line.stage === 'overdue' ? `Was due ${line.dueOn}.` : `Due ${line.dueOn}.`
}

const WHY = 'ISO 14001 clause 6.1.3 asks the organization to keep its compliance obligations, permits '
  + 'among them, current. Record the renewal when it is submitted, and mark each condition done with its evidence.'

function displayName(a: PermitsDueArgs): string {
  return a.recipientName.trim() || a.to.split('@')[0] || 'there'
}

export function renderText(a: PermitsDueArgs): string {
  const renewals = a.renewals.map(r => {
    const number = r.permitNumber ? ` (${r.permitNumber})` : ''
    const critical = r.businessCritical ? ' [business-critical]' : ''
    return `  • ${r.permitTitle}${number} — ${r.agency}${critical}\n    ${renewalWording(r)} ${r.url}`
  }).join('\n\n')
  const conditions = a.conditions.map(c =>
    `  • ${c.conditionTitle} — ${c.permitTitle}\n    ${conditionWording(c)} ${c.url}`).join('\n\n')

  return `Hi ${displayName(a)},

These permits and permit conditions in ${a.tenantName} need attention:
${renewals ? `\nRenewals\n\n${renewals}\n` : ''}${conditions ? `\nConditions\n\n${conditions}\n` : ''}
${WHY}

— SoteriaField on behalf of ${a.tenantName}
${a.unsubscribeUrl ? unsubscribeFooterText(a.unsubscribeUrl, 'reminder emails') : ''}`
}

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const TIER_COLOUR: Record<string, string> = { 180: '#5b6675', 90: '#b45309', 30: '#b45309', passed: '#b91c1c' }

function section(heading: string, rows: string): string {
  return rows === '' ? '' : `
    <tr><td style="padding:0 28px 6px 28px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5b6675;margin:8px 0;">${escapeHtml(heading)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e6ebf2;border-radius:8px;overflow:hidden;">
        ${rows}
      </table>
    </td></tr>`
}

export function renderHtml(a: PermitsDueArgs): string {
  const renewalRows = a.renewals.map(r => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;border-left:4px solid ${TIER_COLOUR[String(r.tier)]};">
        <a href="${escapeHtml(r.url)}" style="color:#1a2230;text-decoration:none;font-weight:600;">${escapeHtml(r.permitTitle)}</a>
        <div style="font-size:11px;color:#5b6675;margin-top:2px;">${escapeHtml(r.agency)}${r.permitNumber ? ` · ${escapeHtml(r.permitNumber)}` : ''}${r.businessCritical ? ' · business-critical' : ''}</div>
        <div style="font-size:13px;margin-top:4px;">${escapeHtml(renewalWording(r))}</div>
      </td>
    </tr>`).join('')
  const conditionRows = a.conditions.map(c => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e6ebf2;border-left:4px solid ${c.stage === 'overdue' ? '#b91c1c' : '#b45309'};">
        <a href="${escapeHtml(c.url)}" style="color:#1a2230;text-decoration:none;font-weight:600;">${escapeHtml(c.conditionTitle)}</a>
        <div style="font-size:11px;color:#5b6675;margin-top:2px;">${escapeHtml(c.permitTitle)}</div>
        <div style="font-size:13px;margin-top:4px;">${escapeHtml(conditionWording(c))}</div>
      </td>
    </tr>`).join('')
  const total = a.renewals.length + a.conditions.length

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Permits</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${total} need attention · ${escapeHtml(a.tenantName)}</div>
    </td></tr>
    <tr><td style="padding:22px 28px 4px 28px;">
      <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Hi ${escapeHtml(displayName(a))},</p>
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">${escapeHtml(WHY)}</p>
    </td></tr>${section('Renewals', renewalRows)}${section('Conditions', conditionRows)}
    <tr><td style="padding:8px 28px 20px 28px;">
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
