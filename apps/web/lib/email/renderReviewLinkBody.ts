// Pure renderer for the review-link email body. Used by:
//   - apps/web/lib/email/sendReviewLink.ts (server-side Resend send)
//   - apps/web/components/departments/ClientReviewPanel.tsx
//     (client-side mailto: + clipboard fallback)
//
// Kept dependency-free (no Resend, no Sentry, no Node-only APIs) so
// it ships in the client bundle as well as the server one. The
// wording must stay identical across both channels — the reviewer
// shouldn't be able to tell whether the message was sent via
// Soteria's Resend account or pasted into Gmail by the admin.

export interface ReviewLinkBodyArgs {
  reviewerName:  string
  /**
   * Reviewer's email. Used as a fallback for the greeting when
   * reviewerName is empty (we use the local-part).
   */
  reviewerEmail: string
  tenantName:    string
  department:    string
  placardCount:  number
  reviewUrl:     string
  /** ISO date string. Rendered as "Sep 30, 2026" in the body. */
  expiresAt:     string
  /** Optional admin note shown in a quoted block above the link. */
  adminMessage?: string
}

export interface ReviewLinkBody {
  subject: string
  body:    string
}

// Mailto URLs are capped by some clients (Outlook desktop ~2 KB).
// Body is normally well under 1 KB; admin_message is the only
// unbounded field, so we truncate it specifically when rendering for
// a mailto context. Server-side Resend renderings pass through the
// full message — only the optional `truncateMessage` toggle below
// shortens it.
const MAILTO_MAX_ADMIN_MESSAGE_CHARS = 1500
const MAILTO_TRUNCATION_MARKER =
  '… [message truncated; see review portal for the full version]'

export interface RenderOptions {
  /**
   * Truncate `adminMessage` so the rendered body fits inside a
   * `mailto:` URL even on clients with restrictive limits. The
   * full message stays intact in the DB row.
   */
  truncateAdminMessageForMailto?: boolean
}

export function renderReviewLinkBody(
  args: ReviewLinkBodyArgs,
  opts: RenderOptions = {},
): ReviewLinkBody {
  const subject = `Please review LOTO placards for ${args.department} — ${args.tenantName}`

  const displayName = (args.reviewerName?.trim()) || localPart(args.reviewerEmail) || 'there'
  const placardWord = args.placardCount === 1 ? 'placard' : 'placards'

  const adminMessage = opts.truncateAdminMessageForMailto
    ? truncate(args.adminMessage ?? '', MAILTO_MAX_ADMIN_MESSAGE_CHARS)
    : args.adminMessage ?? ''

  const adminBlock = adminMessage.trim()
    ? `\n\n  > ${adminMessage.trim().split('\n').join('\n  > ')}\n`
    : ''

  const body = `Hi ${displayName},

${args.tenantName}'s ${args.department} department has ${args.placardCount} LOTO ${placardWord} ready for your review.${adminBlock}

Open the review portal (no sign-in required):
  ${args.reviewUrl}

You can leave notes on any placard, then sign off on the whole batch
(Approve / Needs changes). The link expires ${formatDate(args.expiresAt)}.

If you have any trouble, just reply to this email.

— Soteria FIELD on behalf of ${args.tenantName}
`

  return { subject, body }
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

function localPart(emailLike: string | undefined): string {
  if (!emailLike) return ''
  const at = emailLike.indexOf('@')
  return at === -1 ? '' : emailLike.slice(0, at)
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - MAILTO_TRUNCATION_MARKER.length) + MAILTO_TRUNCATION_MARKER
}
