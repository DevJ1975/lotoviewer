// Review-portal email helper. Mirrors apps/web/lib/email/sendInvite.ts
// — same Resend client, same Sentry error logging, same env-var
// fallbacks. Used by /api/admin/review-links to send a tokenized
// review link to a non-Soteria-account reviewer.
//
// Returns true on successful send. Returns false (and logs to Sentry)
// when RESEND_API_KEY isn't set, when Resend rejects the request, or
// when the network call throws. Callers bubble the boolean back to
// the UI as `emailSent` so the admin can fall back to copy-pasting
// the review URL directly.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'

export interface ReviewLinkEmailArgs {
  to:             string
  reviewerName:   string
  /** Tenant whose placards are being reviewed; appears in subject + body. */
  tenantName:     string
  department:     string
  /** N placards in the department — sets reviewer expectation. */
  placardCount:   number
  /** Fully-qualified URL to /review/[token]. Used as the call-to-action. */
  reviewUrl:      string
  /** ISO date string, formatted in the email as "Sept 30, 2026". */
  expiresAt:      string
  /** Optional admin note shown in a quoted block above the button. */
  adminMessage?:  string
  /**
   * Reply-to email — usually the admin who clicked Send. The reviewer
   * tapping Reply gets the right person, not a no-reply alias.
   */
  replyTo?:       string
  /** Resend message-id is returned for support / deliverability tracing. */
}

/**
 * Send a review-portal invitation email.
 *
 * Returns:
 *   { sent: true,  providerId: string }  — Resend accepted; providerId is the message id.
 *   { sent: false, providerId: null }    — RESEND_API_KEY missing, send rejected, or network threw.
 */
export async function sendReviewLinkEmail(
  args: ReviewLinkEmailArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[review-link-email] RESEND_API_KEY not set — skipping send')
    return { sent: false, providerId: null }
  }

  // From-address precedence — same fallback ladder as the invite helper.
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const subject = `Please review LOTO placards for ${args.department} — ${args.tenantName}`

  const text = renderText(args)
  const html = renderHtml(args)

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to:        args.to,
      subject,
      text,
      html,
      replyTo:   args.replyTo,
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendReviewLinkEmail', stage: 'resend' } })
      console.error('[review-link-email] Resend rejected the send', error)
      return { sent: false, providerId: null }
    }
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendReviewLinkEmail', stage: 'resend' } })
    console.error('[review-link-email] send threw', err)
    return { sent: false, providerId: null }
  }
}

function formatDate(iso: string): string {
  // Locale-free, en-US-ish output so the email reads consistently
  // regardless of the recipient's mail-client locale: "Sep 30, 2026".
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return iso
  }
}

function renderText(a: ReviewLinkEmailArgs): string {
  const dispName = a.reviewerName || a.to.split('@')[0]!
  const adminBlock = a.adminMessage?.trim()
    ? `\n\n  > ${a.adminMessage.trim().split('\n').join('\n  > ')}\n`
    : ''
  return `Hi ${dispName},

${a.tenantName}'s ${a.department} department has ${a.placardCount} LOTO ${a.placardCount === 1 ? 'placard' : 'placards'} ready for your review.${adminBlock}

Open the review portal (no sign-in required):
  ${a.reviewUrl}

You can leave notes on any placard, then sign off on the whole batch
(Approve / Needs changes). The link expires ${formatDate(a.expiresAt)}.

If you have any trouble, just reply to this email.

— Soteria FIELD on behalf of ${a.tenantName}
`
}

function renderHtml(a: ReviewLinkEmailArgs): string {
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const dispName = safe(a.reviewerName || a.to.split('@')[0]!)
  const placardWord = a.placardCount === 1 ? 'placard' : 'placards'
  const adminMessageBlock = a.adminMessage?.trim()
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-left:3px solid #214488;border-radius:0 6px 6px 0;margin:0 0 18px 0;">
        <tr><td style="padding:12px 14px;font-size:13px;font-style:italic;color:#1a2230;line-height:1.55;">
          ${safe(a.adminMessage.trim()).replace(/\n/g, '<br>')}
        </td></tr>
      </table>`
    : ''

  const reviewHostLabel = a.reviewUrl.replace(/^https?:\/\//, '').split('/')[0]

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD · Placard review</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${safe(a.tenantName)} · ${safe(a.department)}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${dispName},</p>
      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;">
        <strong>${safe(a.tenantName)}</strong>'s <strong>${safe(a.department)}</strong> department has
        <strong>${a.placardCount}</strong> LOTO ${placardWord} ready for your review.
      </p>
      ${adminMessageBlock}
      <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;">
        No sign-in required. Tap the button below to open the review portal,
        leave notes on any placard, and sign off on the batch.
      </p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.reviewUrl)}" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Open the review portal →</a>
      </p>
      <p style="margin:0 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Link expires <strong>${safe(formatDate(a.expiresAt))}</strong>.
        Trouble opening it? Just reply to this email.
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent on behalf of ${safe(a.tenantName)} · <a href="${safe(a.reviewUrl)}" style="color:#214488;text-decoration:none;">${safe(reviewHostLabel ?? '')}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
