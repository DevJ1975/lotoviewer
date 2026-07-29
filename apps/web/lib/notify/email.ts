import type { ChannelSendResult } from './sms'
import { sendEmail } from '@/lib/email/core'

// Generic email channel adapter for the multi-channel dispatcher. Routes
// through the shared send core (lib/email/core.ts) so it inherits retry +
// the email_log audit trail. The recipient is in the channel config.
// Fail-soft.

export async function sendChannelEmail(config: Record<string, unknown>, subject: string, text: string): Promise<ChannelSendResult> {
  const to = String(config.to ?? '')
  if (!process.env.RESEND_API_KEY || !to) return { sent: false, error: 'email_not_configured' }
  const { sent } = await sendEmail({ kind: 'channel', to, subject, text })
  return sent ? { sent: true } : { sent: false, error: 'email_send_failed' }
}
