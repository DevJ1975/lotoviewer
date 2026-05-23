import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import type { ChannelSendResult } from './sms'

// Generic email channel adapter (reuses Resend). The recipient is in the
// channel config. Fail-soft.

export async function sendChannelEmail(config: Record<string, unknown>, subject: string, text: string): Promise<ChannelSendResult> {
  const apiKey = process.env.RESEND_API_KEY
  const to = String(config.to ?? '')
  if (!apiKey || !to) return { sent: false, error: 'email_not_configured' }
  const from = process.env.INVITE_FROM_EMAIL ?? process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'
  try {
    const { error } = await new Resend(apiKey).emails.send({ from, to, subject, text })
    if (error) return { sent: false, error: error.message }
    return { sent: true }
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'notify-email' } })
    return { sent: false, error: 'email_threw' }
  }
}
