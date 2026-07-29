import { afterEach, describe, expect, it, vi } from 'vitest'
import { sdsFallbackConfigured, isAiUnavailable, parseSdsViaFallback } from '@/lib/ai/sdsFallback'

const ORIG_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIG_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sdsFallbackConfigured', () => {
  it('is false without SDS_PARSER_URL', () => {
    delete process.env.SDS_PARSER_URL
    expect(sdsFallbackConfigured()).toBe(false)
  })
  it('is true with SDS_PARSER_URL', () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    expect(sdsFallbackConfigured()).toBe(true)
  })
})

describe('isAiUnavailable', () => {
  it('treats 429 and 5xx as unavailable', () => {
    expect(isAiUnavailable({ status: 429 })).toBe(true)
    expect(isAiUnavailable({ status: 500 })).toBe(true)
    expect(isAiUnavailable({ status: 503 })).toBe(true)
  })
  it('treats a usage-limit / credit 400 as unavailable', () => {
    expect(isAiUnavailable(Object.assign(new Error('You have reached your specified API usage limits.'), { status: 400 }))).toBe(true)
    expect(isAiUnavailable(Object.assign(new Error('Your credit balance is too low'), { status: 400 }))).toBe(true)
  })
  it('does NOT fall back on a plain 400 (e.g. bad PDF)', () => {
    expect(isAiUnavailable(Object.assign(new Error('PDF exceeds the 100-page limit.'), { status: 400 }))).toBe(false)
  })
  it('is false for errors without an HTTP status', () => {
    expect(isAiUnavailable(new Error('boom'))).toBe(false)
    expect(isAiUnavailable(null)).toBe(false)
  })
})

describe('parseSdsViaFallback', () => {
  const pdf = Buffer.from('%PDF-1.4 minimal')

  it('returns null when not configured (no network call)', async () => {
    delete process.env.SDS_PARSER_URL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await parseSdsViaFallback(pdf)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs to /parse/file and returns the payload on 200', async () => {
    process.env.SDS_PARSER_URL = 'http://svc/' // trailing slash collapsed
    const payload = { product_name: 'Acetone', confidence: { overall: 'medium' } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload })
    vi.stubGlobal('fetch', fetchMock)

    const out = await parseSdsViaFallback(pdf)
    expect(out).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('http://svc/parse/file', expect.objectContaining({ method: 'POST' }))
  })

  it('sends X-API-Key when configured', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    process.env.SDS_PARSER_API_KEY = 'secret'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await parseSdsViaFallback(pdf)
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(opts.headers['x-api-key']).toBe('secret')
  })

  it('returns null on a non-2xx response', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }))
    expect(await parseSdsViaFallback(pdf)).toBeNull()
  })

  it('returns null (never throws) when the request fails', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await parseSdsViaFallback(pdf)).toBeNull()
  })
})
