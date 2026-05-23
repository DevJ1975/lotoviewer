import * as Sentry from '@sentry/nextjs'

// Twilio SMS adapter. Credentials come from the channel config, falling back
// to env. Fail-soft: returns { sent:false, error } rather than throwing.

export interface ChannelSendResult { sent: boolean; error?: string }

export async function sendSms(config: Record<string, unknown>, message: string): Promise<ChannelSendResult> {
  const sid   = String(config.account_sid ?? process.env.TWILIO_ACCOUNT_SID ?? '')
  const token = String(config.auth_token  ?? process.env.TWILIO_AUTH_TOKEN  ?? '')
  const from  = String(config.from        ?? process.env.TWILIO_FROM        ?? '')
  const to    = String(config.to ?? '')
  if (!sid || !token || !from || !to) return { sent: false, error: 'sms_not_configured' }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: message.slice(0, 1500) }),
    })
    if (!res.ok) return { sent: false, error: `twilio_${res.status}` }
    return { sent: true }
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'notify-sms' } })
    return { sent: false, error: 'sms_threw' }
  }
}
