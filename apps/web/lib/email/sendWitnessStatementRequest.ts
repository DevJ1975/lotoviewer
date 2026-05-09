// Witness-statement request email — tokenized public link sent to a
// non-Soteria witness (typically a contractor or visitor) so they can
// submit their statement without needing an account.
//
// The token lives in incident_witness_statements (migration 061) and
// is single-use + expirable. The public submission endpoint at
// /api/witness/[token]/submit verifies the token before persisting.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

export interface WitnessStatementRequestArgs {
  to:                 string
  witnessName?:       string | null
  reportNumber:       string
  /** What happened — short summary the requester typed when issuing
   *  the link. Helps the witness orient before reading the prompt. */
  contextSummary?:    string | null
  appUrl:             string
  /** Token from incident_witness_statements.collection_token. */
  token:              string
  expiresAt:          string
  /** Person who triggered this send — admin or owner. */
  requesterName?:     string | null
  tenantName?:        string | null
  tenantId?:          string | null
  triggeredBy?:       string | null
}

export async function sendWitnessStatementRequestEmail(
  args: WitnessStatementRequestArgs,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const subject = args.tenantName
    ? `[${args.reportNumber}] Witness statement requested — ${args.tenantName}`
    : `[${args.reportNumber}] Witness statement requested`
  const tenantId = args.tenantId ?? null
  const triggeredBy = args.triggeredBy ?? null

  if (!apiKey) {
    console.warn('[witness-request] RESEND_API_KEY not set — skipping send')
    await logEmailSend({
      kind: 'incident-witness-request', to: args.to, subject,
      tenantId, triggeredBy,
      status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return false
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const link = `${args.appUrl.replace(/\/$/, '')}/witness/${encodeURIComponent(args.token)}`
  const text = renderText(args, link)
  const html = renderHtml(args, link)

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendWitnessStatementRequestEmail', stage: 'resend' } })
      await logEmailSend({
        kind: 'incident-witness-request', to: args.to, subject,
        tenantId, triggeredBy,
        status: 'failed', errorText: error.message,
      })
      return false
    }
    await logEmailSend({
      kind: 'incident-witness-request', to: args.to, subject,
      tenantId, triggeredBy,
      status: 'sent', providerId: data?.id ?? null,
    })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendWitnessStatementRequestEmail', stage: 'resend' } })
    await logEmailSend({
      kind: 'incident-witness-request', to: args.to, subject,
      tenantId, triggeredBy,
      status: 'failed', errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

function renderText(a: WitnessStatementRequestArgs, link: string): string {
  const name = a.witnessName?.trim() || a.to.split('@')[0]!
  const requesterLine = a.requesterName ? `\n${a.requesterName} has asked you to share what you saw.` : ''
  const contextLine = a.contextSummary ? `\n\nContext from the requester:\n${a.contextSummary}` : ''
  return `Hi ${name},

You're being asked to provide a witness statement for incident
${a.reportNumber}.${requesterLine}${contextLine}

Submit your statement here (this link is single-use and expires
${a.expiresAt}):

  ${link}

Your statement will be saved with the incident record. We do not
collect any account credentials — you don't need to sign in.

If you weren't expecting this email, you can ignore it; the link
will expire on its own.

— SoteriaField
`
}

function renderHtml(a: WitnessStatementRequestArgs, link: string): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const name = a.witnessName?.trim() || a.to.split('@')[0]!
  const contextBlock = a.contextSummary
    ? `<div style="margin-top:14px;padding:12px 14px;background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;font-size:13px;line-height:1.55;white-space:pre-wrap;">${safe(a.contextSummary)}</div>`
    : ''
  const requesterLine = a.requesterName
    ? `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">${safe(a.requesterName)} has asked you to share what you saw.</p>`
    : ''
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">Witness statement requested</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(name)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">You're being asked to provide a witness statement for incident <strong>${safe(a.reportNumber)}</strong>.</p>
      ${requesterLine}
      ${contextBlock}
      <p style="margin:18px 0 22px 0;text-align:center;">
        <a href="${safe(link)}" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Submit statement →</a>
      </p>
      <p style="margin:0;font-size:12px;line-height:1.55;color:#5b6675;">
        This link is single-use and expires ${safe(a.expiresAt)}. We do not collect account credentials — you don't need to sign in. If you weren't expecting this email, you can ignore it.
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
