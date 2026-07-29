// Review-portal email helper. Used by /api/admin/review-links to send a
// tokenized review link to a non-Soteria-account reviewer.
//
// Returns { sent, providerId } straight from the send core (lib/email/core.ts),
// which owns the Resend client, retry, and email_log write. Callers bubble
// `sent` back to the UI as `emailSent` so the admin can fall back to
// copy-pasting the review URL directly.

import { sendEmail } from '@/lib/email/core'
import { renderEmailLayout, escapeHtml } from '@/lib/email/layout'
import { renderReviewLinkBody } from './renderReviewLinkBody'

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
  // Subject + plain-text body come from the shared pure renderer so the
  // manual-send (mailto) path produces identical wording. HTML is server-only.
  const { subject, body: text } = renderReviewLinkBody({
    reviewerName:  args.reviewerName,
    reviewerEmail: args.to,
    tenantName:    args.tenantName,
    department:    args.department,
    placardCount:  args.placardCount,
    reviewUrl:     args.reviewUrl,
    expiresAt:     args.expiresAt,
    adminMessage:  args.adminMessage,
  })
  const html = renderHtml(args)

  return sendEmail({
    kind: 'review-link',
    to: args.to,
    subject, text, html,
    replyTo: args.replyTo,
  })
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

function renderHtml(a: ReviewLinkEmailArgs): string {
  const safe = escapeHtml
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

  return renderEmailLayout({
    eyebrow: 'SoteriaField · Placard review',
    heading: `${safe(a.tenantName)} · ${safe(a.department)}`,
    footerHtml: `Sent on behalf of ${safe(a.tenantName)} · <a href="${safe(a.reviewUrl)}" style="color:#214488;text-decoration:none;">${safe(reviewHostLabel ?? '')}</a>`,
    contentHtml: `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${dispName},</p>
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
      </p>`,
  })
}
