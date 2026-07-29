import { describe, it, expect } from 'vitest'
import { redactUrl, scrub, scrubSentryEvent, scrubBreadcrumb } from '@/lib/security/scrubEvent'

const RAW_TOKEN = 'x9Fq2LmN8pQrStUvWxYz0123456789AbCdEfGhIjKlMnO'

describe('redactUrl', () => {
  it('redacts an invite token in a relative URL and stays relative', () => {
    const out = redactUrl(`/accept-invite?token=${RAW_TOKEN}`)
    expect(out).not.toContain(RAW_TOKEN)
    expect(out).toBe('/accept-invite?token=%5Bredacted%5D')
  })

  it('redacts an invite token in an absolute URL', () => {
    const out = redactUrl(`https://app.example/accept-invite?token=${RAW_TOKEN}`)
    expect(out).not.toContain(RAW_TOKEN)
    expect(out.startsWith('https://app.example/accept-invite')).toBe(true)
  })

  it('redacts Supabase recovery tokens in the fragment', () => {
    // detectSessionInUrl with no PKCE puts a live session in the fragment.
    const out = redactUrl(`/reset-password#access_token=${RAW_TOKEN}&refresh_token=r-${RAW_TOKEN}&type=recovery`)
    expect(out).not.toContain(RAW_TOKEN)
    expect(out).toContain('type=recovery')
  })

  it('leaves harmless parameters and their values alone', () => {
    expect(redactUrl('/equipment/42?tab=photos&page=2')).toBe('/equipment/42?tab=photos&page=2')
    expect(redactUrl('/departments')).toBe('/departments')
  })

  it('redacts other sensitive parameter names too', () => {
    expect(redactUrl('/x?password=hunter2')).not.toContain('hunter2')
    expect(redactUrl('/x?api_key=sk-abc')).not.toContain('sk-abc')
    expect(redactUrl('/x?secret=shh')).not.toContain('shh')
  })

  it('never throws, and drops an unparseable value rather than passing it on', () => {
    expect(() => redactUrl('http://')).not.toThrow()
    expect(redactUrl('')).toBe('')
  })
})

describe('scrub', () => {
  it('redacts by key name, recursively', () => {
    const out = scrub({
      authorization: 'Bearer abc',
      nested: { api_key: 'sk-1', safe: 'keep' },
      list: [{ password: 'p' }],
    }) as Record<string, never>

    expect(JSON.stringify(out)).not.toContain('Bearer abc')
    expect(JSON.stringify(out)).not.toContain('sk-1')
    expect(JSON.stringify(out)).not.toContain('"p"')
    expect(JSON.stringify(out)).toContain('keep')
  })
})

describe('scrubSentryEvent', () => {
  it('redacts the request URL, which the key-name scrubber never saw', () => {
    const event = scrubSentryEvent({
      request: { url: `https://app.example/accept-invite?token=${RAW_TOKEN}` },
    })
    expect(JSON.stringify(event)).not.toContain(RAW_TOKEN)
  })

  it('redacts the transaction name', () => {
    const event = scrubSentryEvent({ transaction: `/accept-invite?token=${RAW_TOKEN}` })
    expect(event.transaction).not.toContain(RAW_TOKEN)
  })

  it('still redacts headers, data, cookies and extras', () => {
    const event = scrubSentryEvent({
      request: {
        headers: { authorization: 'Bearer jwt-here' },
        data: { password: 'hunter2' },
        cookies: { session_token: 'abc' },
      },
      extra: { anthropic_api_key: 'sk-ant' },
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('Bearer jwt-here')
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('sk-ant')
  })
})

describe('scrubBreadcrumb', () => {
  it('redacts navigation URLs under from/to — the case the old scrubber missed', () => {
    // `from` and `to` match no needle, so a key-name-only pass walked past
    // them and shipped the raw token to Sentry.
    const crumb = scrubBreadcrumb({
      data: { from: '/login', to: `/accept-invite?token=${RAW_TOKEN}` },
    })
    expect(JSON.stringify(crumb)).not.toContain(RAW_TOKEN)
  })

  it('redacts fetch/xhr breadcrumb urls', () => {
    const crumb = scrubBreadcrumb({ data: { url: `/api/x?token=${RAW_TOKEN}`, status_code: 200 } })
    expect(JSON.stringify(crumb)).not.toContain(RAW_TOKEN)
    expect(crumb.data!.status_code).toBe(200)
  })

  it('passes through a breadcrumb with no data', () => {
    expect(scrubBreadcrumb({})).toEqual({})
  })
})
