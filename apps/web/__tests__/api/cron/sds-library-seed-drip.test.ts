// Auth-boundary tests for /api/cron/sds-library-seed-drip. The research math is
// exercised through the seedChemicalList unit tests + the engine; here we only
// assert the CRON_SECRET / internal-secret gate and the no-active-run path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cronLogMock = vi.fn(async (_req: Request, handler: () => Promise<Response>) => handler())
vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (req: Request, handler: () => Promise<Response>) => cronLogMock(req, handler),
}))

// No researching run → the drip short-circuits to "no active seed run".
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { GET, POST } from '@/app/api/cron/sds-library-seed-drip/route'

const ORIG_CRON_SECRET = process.env.CRON_SECRET
const ORIG_INTERNAL    = process.env.INTERNAL_PUSH_SECRET

beforeEach(() => {
  cronLogMock.mockClear()
  process.env.CRON_SECRET          = 'cron-secret-value'
  process.env.INTERNAL_PUSH_SECRET = 'internal-secret-value'
})

afterEach(() => {
  process.env.CRON_SECRET          = ORIG_CRON_SECRET
  process.env.INTERNAL_PUSH_SECRET = ORIG_INTERNAL
})

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/cron/sds-library-seed-drip', { method: 'GET', headers })
}

describe('/api/cron/sds-library-seed-drip auth', () => {
  it('rejects a request with no credentials', async () => {
    const res = await GET(reqWith({}))
    expect(res.status).toBe(401)
    expect(cronLogMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer token', async () => {
    const res = await GET(reqWith({ authorization: 'Bearer nope' }))
    expect(res.status).toBe(401)
  })

  it('accepts the CRON_SECRET bearer and reports no active run', async () => {
    const res = await GET(reqWith({ authorization: 'Bearer cron-secret-value' }))
    expect(res.status).toBe(200)
    expect(cronLogMock).toHaveBeenCalledOnce()
    expect(await res.json()).toMatchObject({ processed: 0, note: 'no active seed run' })
  })

  it('accepts the internal secret via x-internal-secret', async () => {
    const res = await POST(reqWith({ 'x-internal-secret': 'internal-secret-value' }))
    expect(res.status).toBe(200)
  })
})
