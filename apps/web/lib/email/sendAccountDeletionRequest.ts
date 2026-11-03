// Support notification for an in-app account deletion request (App Store
// 5.1.1(v)). Same posture as the other senders: boolean return, never
// throws, every attempt logged through instrument.ts.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

export interface AccountDeletionRequestEmailArgs {
  userId:      string
  userEmail:   string
  reason:      string | null
  requestedAt: string
}

const KIND = 'account-deletion-request'

export async function sendAccountDeletionRequestEmail(args: AccountDeletionRequestEmailArgs): Promise<boolean> {
  const to      = process.env.SUPPORT_EMAIL ?? 'jamil@trainovations.com'
  const subject = `Account deletion request: ${args.userEmail}`
  const apiKey  = process.env.RESEND_API_KEY

  if (!apiKey) {
    await logEmailSend({ kind: KIND, to, subject, triggeredBy: args.userId, status: 'skipped', errorText: 'RESEND_API_KEY not set' })
    return false
  }

  const from = process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'
  // Plain text only: the reason is user-supplied, so there is no HTML to escape.
  const text = `A user asked to delete their account from the mobile app.

  User:      ${args.userEmail}
  User id:   ${args.userId}
  Requested: ${args.requestedAt}
  Reason:    ${args.reason ?? '(none given)'}

The privacy policy promises removal of personal data within 30 days.
Safety records are retained and anonymized. Mark the row in
account_deletion_requests completed once the account is removed.
`

  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to, subject, text })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendAccountDeletionRequest', stage: 'resend' } })
      await logEmailSend({ kind: KIND, to, subject, triggeredBy: args.userId, status: 'failed', errorText: error.message })
      return false
    }
    await logEmailSend({ kind: KIND, to, subject, triggeredBy: args.userId, status: 'sent', providerId: data?.id ?? null })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendAccountDeletionRequest' } })
    await logEmailSend({
      kind: KIND, to, subject, triggeredBy: args.userId, status: 'failed',
      errorText: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
