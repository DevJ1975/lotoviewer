import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { proxy } from '@/proxy'
import { NextRequest } from 'next/server'

// Origin/Host cross-check proxy. The contract:
//   - GET / HEAD / OPTIONS pass through unconditionally.
//   - On POST / PATCH / PUT / DELETE under /api/*, if Origin is
//     present and doesn't match Host (or the allowlist), reject 403.
//   - Bypass paths (/api/cron/*, /api/webhooks/*, /api/anon/*,
//     /api/anonymous-report/*, /api/review/*, /api/scan/*,
//     /api/health) skip the check.
//   - No Origin header → pass (server-to-server / CLI).

function makeReq(opts: {
  url: string
  method?: string
  origin?: string
  host?: string
}): NextRequest {
  const headers = new Headers()
  if (opts.origin) headers.set('origin', opts.origin)
  if (opts.host)   headers.set('host', opts.host)
  return new NextRequest(opts.url, {
    method:  opts.method ?? 'POST',
    headers,
  })
}

describe('proxy: Origin/Host cross-check', () => {
  beforeEach(() => {
    delete process.env.ALLOWED_ORIGIN_HOSTS
  })

  it('passes GET requests through unchanged', () => {
    const req = makeReq({ url: 'https://app.example.com/api/incidents', method: 'GET', origin: 'https://evil.com', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('passes POST with matching Origin === Host', () => {
    const req = makeReq({ url: 'https://app.example.com/api/incidents', method: 'POST', origin: 'https://app.example.com', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('rejects POST with mismatched Origin', async () => {
    const req = makeReq({ url: 'https://app.example.com/api/incidents', method: 'POST', origin: 'https://evil.com', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Origin mismatch' })
  })

  it('rejects POST with malformed Origin URL', async () => {
    const req = makeReq({ url: 'https://app.example.com/api/incidents', method: 'POST', origin: 'not-a-url', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Invalid Origin header' })
  })

  it('passes POST with no Origin (server-to-server / CLI)', () => {
    const req = makeReq({ url: 'https://app.example.com/api/incidents', method: 'POST', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('honours ALLOWED_ORIGIN_HOSTS for known additional hosts', () => {
    process.env.ALLOWED_ORIGIN_HOSTS = 'studio.example.com,admin.example.com'
    const req = makeReq({ url: 'https://app.example.com/api/incidents', method: 'POST', origin: 'https://studio.example.com', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('bypasses /api/cron/* (cron secret is the primary defence)', () => {
    const req = makeReq({ url: 'https://app.example.com/api/cron/risk-review-reminders', method: 'POST', origin: 'https://anywhere.invalid', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('bypasses /api/webhooks/* (signature header is the primary defence)', () => {
    const req = makeReq({ url: 'https://app.example.com/api/webhooks/stripe', method: 'POST', origin: 'https://anywhere.invalid', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('bypasses /api/anonymous-report/* (captcha + IP throttle do the work)', () => {
    const req = makeReq({ url: 'https://app.example.com/api/anonymous-report/submit', method: 'POST', origin: 'https://anywhere.invalid', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })

  it('bypasses /api/review/* (token IS the credential)', () => {
    const req = makeReq({ url: 'https://app.example.com/api/review/abc123', method: 'POST', origin: 'https://anywhere.invalid', host: 'app.example.com' })
    const res = proxy(req)
    expect(res.status).toBe(200)
  })
})
