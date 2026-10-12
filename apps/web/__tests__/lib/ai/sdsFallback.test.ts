import { afterEach, describe, expect, it, vi } from 'vitest'
import { sdsFallbackConfigured, isAiUnavailable, parseSdsViaFallback, enqueueSdsParseJob } from '@/lib/ai/sdsFallback'

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

describe('enqueueSdsParseJob', () => {
  const ids = { sdsId: 'sds-1', tenantId: 'tenant-1', userId: 'user-1' }

  it('returns null when not configured (no network call)', async () => {
    delete process.env.SDS_PARSER_URL
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await enqueueSdsParseJob(ids)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the ids as JSON to /jobs/parse-sds and returns the job id on 202', async () => {
    process.env.SDS_PARSER_URL = 'http://svc/'
    process.env.SDS_PARSER_API_KEY = 'secret'
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, json: async () => ({ job_id: 'job-9', status: 'queued' }) })
    vi.stubGlobal('fetch', fetchMock)

    expect(await enqueueSdsParseJob(ids)).toEqual({ jobId: 'job-9' })
    const [url, opts] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe('http://svc/jobs/parse-sds')
    expect(JSON.parse(opts.body)).toEqual({ sds_id: 'sds-1', tenant_id: 'tenant-1', requested_by: 'user-1' })
    expect(opts.headers['x-api-key']).toBe('secret')
    expect(opts.headers['content-type']).toBe('application/json')
  })

  it('returns null when the service has background jobs off (503)', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503, json: async () => ({ detail: 'disabled' }) }))
    expect(await enqueueSdsParseJob(ids)).toBeNull()
  })

  it('returns null on a 2xx that is not an accepted job', async () => {
    // A 200 would mean something other than "queued" answered; do not
    // tell the user a parse is running when nothing confirmed it.
    process.env.SDS_PARSER_URL = 'http://svc'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => ({ job_id: 'job-9' }) }))
    expect(await enqueueSdsParseJob(ids)).toBeNull()
  })

  it('returns null when the 202 body has no job id', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 202, json: async () => ({}) }))
    expect(await enqueueSdsParseJob(ids)).toBeNull()
  })

  it('returns null (never throws) when the request fails', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    expect(await enqueueSdsParseJob(ids)).toBeNull()
  })
})
