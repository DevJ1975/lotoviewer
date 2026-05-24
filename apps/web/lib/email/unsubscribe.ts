import { createHmac, timingSafeEqual } from 'node:crypto'

// Signed, stateless unsubscribe tokens for RFC 8058 one-click unsubscribe.
//
// A token is `base64url(payload).base64url(hmac-sha256(payload))`. The
// payload carries the (normalized) recipient email + the bulk category they
// are opting out of. Because it is HMAC-signed, the public unsubscribe
// endpoint can trust it without a session — no token store needed.
//
// Server-only (uses node:crypto). The signing secret falls back through
// existing cron secrets so no new env var is required to turn the feature on;
// when none is configured we return null so callers simply omit the header
// rather than ship a link that can never verify.

export interface UnsubscribePayload {
  email:    string
  category: string
}

function secret(): string {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET
    ?? process.env.INTERNAL_PUSH_SECRET
    ?? process.env.CRON_SECRET
    ?? ''
}

export function signUnsubscribeToken(email: string, category: string, key = secret()): string | null {
  if (!key) return null
  const payload = JSON.stringify({ email: email.toLowerCase(), category })
  const body = Buffer.from(payload, 'utf8').toString('base64url')
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyUnsubscribeToken(token: string, key = secret()): UnsubscribePayload | null {
  if (!key || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const body = token.slice(0, dot)
  const expected = createHmac('sha256', key).update(body).digest()
  let given: Buffer
  try { given = Buffer.from(token.slice(dot + 1), 'base64url') } catch { return null }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { email, category } = parsed as Record<string, unknown>
    if (typeof email !== 'string' || typeof category !== 'string') return null
    return { email, category }
  } catch { return null }
}

export interface UnsubscribeLink {
  url:     string
  headers: Record<string, string>
}

// Builds the unsubscribe URL + the List-Unsubscribe headers for a recipient.
// Returns null when no signing secret is configured (caller omits the header).
export function buildUnsubscribe(appUrl: string, email: string, category: string): UnsubscribeLink | null {
  const token = signUnsubscribeToken(email, category)
  if (!token) return null
  const url = `${appUrl.replace(/\/$/, '')}/api/email/unsubscribe?token=${encodeURIComponent(token)}`
  return {
    url,
    headers: {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function unsubscribeFooterText(url: string, label = 'weekly emails'): string {
  return `\nYou're receiving this because you're an owner or admin on SoteriaField.\nUnsubscribe from these ${label}: ${url}\n`
}

export function unsubscribeFooterHtml(url: string, label = 'weekly emails'): string {
  return `<p style="margin:18px 0 0 0;font-size:11px;color:#8a93a3;text-align:center;line-height:1.5;">`
    + `You're receiving this because you're an owner or admin on SoteriaField.<br>`
    + `<a href="${escapeHtml(url)}" style="color:#8a93a3;text-decoration:underline;">Unsubscribe from ${escapeHtml(label)}</a></p>`
}
