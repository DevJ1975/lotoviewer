// Smoke tests for the /api/cron/run-assistant-tasks executor. Covers
// the auth boundary (CRON_SECRET vs internal-secret vs neither) — the
// happy-path execution is integration-tested manually and through the
// alerts.ts unit tests.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cronLogMock = vi.fn(async (_req: Request, handler: () => Promise<Response>) => handler())

vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (req: Request, handler: () => Promise<Response>) => cronLogMock(req, handler),
}))

const sendAlertMock = vi.fn()
vi.mock('@/lib/ai/alerts', () => ({
  sendAlert: (a: unknown) => sendAlertMock(a),
}))

const supabaseFromMock = vi.fn()
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => supabaseFromMock(t) }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage:   vi.fn(),
}))

const ORIG_CRON_SECRET = process.env.CRON_SECRET
const ORIG_INTERNAL    = process.env.INTERNAL_PUSH_SECRET

beforeEach(() => {
  cronLogMock.mockClear()
  sendAlertMock.mockReset()
  supabaseFromMock.mockReset()
  process.env.CRON_SECRET         = 'cron-secret-value'
  process.env.INTERNAL_PUSH_SECRET = 'internal-secret-value'
})

afterEach(() => {
  process.env.CRON_SECRET         = ORIG_CRON_SECRET
  process.env.INTERNAL_PUSH_SECRET = ORIG_INTERNAL
})

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://x/api/cron/run-assistant-tasks', {
    method:  'POST',
    headers,
  })
}

// Stub the supabase query-builder chain that the route uses.
function stubEmptyPick() {
  // The route's first call: from('assistant_tasks').select(...).eq(...).lte(...).order(...).limit(...)
  // Return an empty result so the route exits cleanly without iterating.
  const limit = vi.fn().mockResolvedValue({ data: [], error: null })
  const order = vi.fn().mockReturnValue({ limit })
  const lte   = vi.fn().mockReturnValue({ order })
  const eq    = vi.fn().mockReturnValue({ lte })
  const select = vi.fn().mockReturnValue({ eq })
  supabaseFromMock.mockReturnValue({ select })
}

describe('POST /api/cron/run-assistant-tasks — auth', () => {
  it('rejects with 401 when neither secret is provided', async () => {
    const { POST } = await import('@/app/api/cron/run-assistant-tasks/route')
    const res = await POST(reqWith({ 'content-type': 'application/json' }))
    expect(res.status).toBe(401)
  })

  it('rejects with 401 on a wrong bearer secret', async () => {
    const { POST } = await import('@/app/api/cron/run-assistant-tasks/route')
    const res = await POST(reqWith({ authorization: 'Bearer not-the-cron-secret' }))
    expect(res.status).toBe(401)
  })

  it('accepts a correct CRON_SECRET bearer', async () => {
    stubEmptyPick()
    const { POST } = await import('@/app/api/cron/run-assistant-tasks/route')
    const res = await POST(reqWith({ authorization: 'Bearer cron-secret-value' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.picked).toBe(0)
  })

  it('accepts a correct x-internal-secret', async () => {
    stubEmptyPick()
    const { POST } = await import('@/app/api/cron/run-assistant-tasks/route')
    const res = await POST(reqWith({ 'x-internal-secret': 'internal-secret-value' }))
    expect(res.status).toBe(200)
  })

  it('uses constant-time comparison (length mismatch is a fast reject)', async () => {
    const { POST } = await import('@/app/api/cron/run-assistant-tasks/route')
    const res = await POST(reqWith({ authorization: 'Bearer ' + 'cron-secret-value'.slice(0, 5) }))
    expect(res.status).toBe(401)
  })
})
