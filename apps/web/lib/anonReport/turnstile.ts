// Server-side verification for Cloudflare Turnstile tokens.
//
// Turnstile is a privacy-friendly captcha that doesn't require a
// 3rd-party cookie and renders invisibly for most users. We only
// require it on tokens whose admin has flipped require_captcha=true,
// or after the IP throttle has fired for this client.
//
// Env:
//   TURNSTILE_SITE_KEY     (NEXT_PUBLIC_ ok — exposed to the form)
//   TURNSTILE_SECRET_KEY   (server-only — never expose)
//
// If TURNSTILE_SECRET_KEY is unset (e.g. local dev), verification
// short-circuits to true so contributors can iterate on the form
// without setting up a Cloudflare account. Production deployments
// MUST set the secret; without it the captcha is effectively off.

import * as Sentry from '@sentry/nextjs'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileResult {
  ok:     boolean
  reason?: string
}

export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // In prod, refusing to verify is safer than silently passing.
      return { ok: false, reason: 'captcha-misconfigured' }
    }
    return { ok: true }
  }
  if (!token) return { ok: false, reason: 'missing' }

  try {
    const form = new URLSearchParams()
    form.set('secret',   secret)
    form.set('response', token)
    if (remoteIp) form.set('remoteip', remoteIp)

    const res = await fetch(VERIFY_URL, {
      method:  'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body:    form.toString(),
      // 5 second hard cap — better to fail-closed than hang the
      // submit on a Cloudflare slowdown.
      signal:  AbortSignal.timeout(5_000),
    })
    if (!res.ok) return { ok: false, reason: `siteverify-${res.status}` }
    const body = await res.json() as { success?: boolean; 'error-codes'?: string[] }
    if (body.success) return { ok: true }
    return { ok: false, reason: (body['error-codes'] ?? ['failed']).join(',') }
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'turnstile' } })
    // Fail-closed on network blip — if the captcha was required,
    // that's the right default. The reporter can retry; abuse can't.
    return { ok: false, reason: 'verify-error' }
  }
}
