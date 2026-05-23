// Auth-boundary tests for /api/cron/invite-reminders. The happy-path
// reminder/cancel decisions are covered by the pure planInviteAction unit
// tests; here we only assert the CRON_SECRET / internal-secret gate, which
// is the security boundary for the route.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cronLogMock = vi.fn(async (_req: Request, handler: () => Promise<Response>) => handler())
vi.mock('@/lib/cronInstrumentation', () => ({
  withCronLogging: (req: Request, handler: () => Promise<Response>) => cronLogMock(req, handler),
}))

// supabaseAdmin returns a client whose membership query yields no rows, so
// an authorized call short-circuits to an empty result without needing the
// auth-admin pager.
const isMock = vi.fn(async () => ({ data: [], error: null }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ is: isMock }) }),
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })) } },
  }),
}))

const sendInviteReminderMock = vi.fn(async (_a?: unknown) => ({ sent: true, providerId: 'id' }))
vi.mock('@/lib/email/sendInviteReminder', () => ({
  sendInviteReminder: (a: unknown) => sendInviteReminderMock(a),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { GET, POST } from '@/app/api/cron/invite-reminders/route'

const ORIG_CRON_SECRET = process.env.CRON_SECRET
const ORIG_INTERNAL    = process.env.INTERNAL_PUSH_SECRET

beforeEach(() => {
  cronLogMock.mockClear()
  isMock.mockClear()
  sendInviteReminderMock.mockClear()
  process.env.CRON_SECRET          = 'cron-secret-value'
  process.env.INTERNAL_PUSH_SECRET = 'internal-secret-value'
})

afterEach(() => {
  process.env.CRON_SECRET          = ORIG_CRON_SECRET
  process.env.INTERNAL_PUSH_SECRET = ORIG_INTERNAL
})

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/cron/invite-reminders', { method: 'GET', headers })
}

describe('/api/cron/invite-reminders auth', () => {
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
    expect(body).toMatchObject({ scanned: 0, reminders_sent: 0, invites_cancelled: 0 })
  })

  it('accepts the internal secret via x-internal-secret', async () => {
    const res = await POST(reqWith({ 'x-internal-secret': 'internal-secret-value' }))
    expect(res.status).toBe(200)
  })
})
