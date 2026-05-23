// Auth-boundary tests for /api/cron/scorecard-weekly. The week-over-week
// math is covered by the pure scorecardWeatherReport unit tests; here we
// only assert the CRON_SECRET / internal-secret gate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cronLogMock = vi.fn(async (_req: Request, handler: () => Promise<Response>) => handler())
vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (req: Request, handler: () => Promise<Response>) => cronLogMock(req, handler),
}))

// supabaseAdmin returns a client whose tenants query yields no rows, so an
// authorized call short-circuits to an empty result.
const isMock = vi.fn(async () => ({ data: [], error: null }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ is: isMock }) }),
  }),
}))

const sendMock = vi.fn(async (_a?: unknown) => ({ sent: true }))
vi.mock('@/lib/email/sendScorecardWeatherReport', () => ({
  sendScorecardWeatherReport: (a: unknown) => sendMock(a),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { GET, POST } from '@/app/api/cron/scorecard-weekly/route'

const ORIG_CRON_SECRET = process.env.CRON_SECRET
const ORIG_INTERNAL    = process.env.INTERNAL_PUSH_SECRET

beforeEach(() => {
  cronLogMock.mockClear()
  isMock.mockClear()
  sendMock.mockClear()
  process.env.CRON_SECRET          = 'cron-secret-value'
  process.env.INTERNAL_PUSH_SECRET = 'internal-secret-value'
})

afterEach(() => {
  process.env.CRON_SECRET          = ORIG_CRON_SECRET
  process.env.INTERNAL_PUSH_SECRET = ORIG_INTERNAL
})

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/cron/scorecard-weekly', { method: 'GET', headers })
}

describe('/api/cron/scorecard-weekly auth', () => {
  it('rejects a request with no credentials', async () => {
    const res = await GET(reqWith({}))
    expect(res.status).toBe(401)
    expect(cronLogMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer token', async () => {
    const res = await GET(reqWith({ authorization: 'Bearer nope' }))
    expect(res.status).toBe(401)
  })

  it('accepts the CRON_SECRET bearer token', async () => {
    const res = await GET(reqWith({ authorization: 'Bearer cron-secret-value' }))
    expect(res.status).toBe(200)
    expect(cronLogMock).toHaveBeenCalledOnce()
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, sent: 0, skipped: 0, failed: 0, tenants: 0 })
  })

  it('accepts the internal secret via x-internal-secret', async () => {
    const res = await POST(reqWith({ 'x-internal-secret': 'internal-secret-value' }))
    expect(res.status).toBe(200)
  })
})
