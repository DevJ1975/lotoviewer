import * as Sentry from '@sentry/nextjs'
import type { ChannelSendResult } from './sms'

// Microsoft Teams incoming-webhook adapter. The webhook URL is tenant-admin
// supplied, so we apply a basic SSRF guard (https + public host only). Robust
// private-IP/DNS-rebind protection is a planned platform-wide hardening item
// (docs/security/POSTURE.md §10).

function isSafeWebhookUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local')) return false
  // Block obvious private / loopback / link-local literals.
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return false
  return true
}

export async function sendTeams(config: Record<string, unknown>, title: string, text: string): Promise<ChannelSendResult> {
  const url = String(config.webhook_url ?? '')
  if (!url) return { sent: false, error: 'teams_not_configured' }
  if (!isSafeWebhookUrl(url)) return { sent: false, error: 'teams_url_rejected' }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, text }),
    })
    if (!res.ok) return { sent: false, error: `teams_${res.status}` }
    return { sent: true }
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'notify-teams' } })
    return { sent: false, error: 'teams_threw' }
  }
}
