// Composes the plain-text message an admin hands to a worker after
// granting access or resetting a password.
//
// Why this is a pure function in its own module: the wording carries
// real operational weight (a worker who misreads it calls the safety
// lead instead of signing in), and it is the one part of the flow we
// can test without Supabase, Resend, or a browser. Keep it free of I/O.
//
// Plain text on purpose — this gets pasted into SMS, WhatsApp, Teams,
// or an email body, and every one of those mangles HTML differently.

export type AccessMessageKind = 'invite' | 'reset'

export interface AccessMessageInput {
  /** 'invite' → first-time access. 'reset' → credentials rotated on a live account. */
  kind:           AccessMessageKind
  /** Member's display name. Blank falls back to a generic greeting. */
  recipientName:  string
  /** The address they sign in with — worth restating; workers forget which one. */
  email:          string
  /** Sign-in origin, e.g. https://soteriafield.app */
  appUrl:         string
  /** Single-use accept-invite link, when one was minted. */
  inviteUrl?:     string | null
  /** One-time password, when one was issued. */
  tempPassword?:  string | null
  /** TTL of `inviteUrl`. Omitted or <= 0 suppresses the expiry sentence. */
  expiresInDays?: number
  /** Company/tenant name, for context when a worker holds several logins. */
  tenantName?:    string | null
}

const PRODUCT_NAME = 'Soteria Field'

/**
 * First name only. Workers read "Hi Jose," as a message from a person and
 * "Hi Jose Ramirez-Delgado," as a message from a billing system.
 */
function greetingName(recipientName: string): string {
  const first = recipientName.trim().split(/\s+/)[0] ?? ''
  return first || 'there'
}

function pluralDays(days: number): string {
  return days === 1 ? '1 day' : `${days} days`
}

export function composeAccessMessage(input: AccessMessageInput): string {
  const {
    kind, recipientName, email, appUrl,
    inviteUrl, tempPassword, expiresInDays, tenantName,
  } = input

  const forTenant = tenantName?.trim() ? ` for ${tenantName.trim()}` : ''
  const lines: string[] = [`Hi ${greetingName(recipientName)},`, '']

  lines.push(
    kind === 'invite'
      ? `You've been given access to ${PRODUCT_NAME}${forTenant}.`
      : `Your ${PRODUCT_NAME} password${forTenant} has been reset.`,
    '',
  )

  if (inviteUrl) {
    const expiry = expiresInDays && expiresInDays > 0
      ? ` (link expires in ${pluralDays(expiresInDays)})`
      : ''
    lines.push(
      kind === 'invite'
        ? `Set up your account here${expiry}:`
        : `Set a new password here${expiry}:`,
      inviteUrl,
      '',
    )
  }

  if (tempPassword) {
    // When a link is present the password is the fallback, not the
    // headline — say so, or workers ignore the link and burn the
    // temporary password on a browser they don't normally use.
    lines.push(
      inviteUrl
        ? `If that link stops working, sign in at ${appUrl} with:`
        : `Sign in at ${appUrl} with:`,
      `  Email:    ${email}`,
      `  Password: ${tempPassword}`,
      '',
      "You'll be asked to choose your own password on first sign-in.",
      '',
    )
  } else if (!inviteUrl) {
    // Neither credential came back (email delivery handled it, or the
    // provisioning call declined to expose one). Point them somewhere
    // real rather than emitting a dead-end message.
    lines.push(
      `Sign in at ${appUrl} with your email address (${email}).`,
      `If you don't have a password yet, use "Forgot password" on that page.`,
      '',
    )
  }

  lines.push('Questions? Just reply to this message.')

  return lines.join('\n')
}
