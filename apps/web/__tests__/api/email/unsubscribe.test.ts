import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upsertMock = vi.fn(async (_row: Record<string, unknown>, _opts?: unknown) => ({ error: null }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: () => ({ upsert: upsertMock }) }),
}))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { GET, POST } from '@/app/api/email/unsubscribe/route'
import { signUnsubscribeToken } from '@/lib/email/unsubscribe'

const ORIG = process.env.EMAIL_UNSUBSCRIBE_SECRET

beforeEach(() => {
  upsertMock.mockClear()
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'route-test-secret'
})
afterEach(() => { process.env.EMAIL_UNSUBSCRIBE_SECRET = ORIG })

function url(token: string): string {
  return `https://app.test/api/email/unsubscribe?token=${encodeURIComponent(token)}`
}

describe('GET /api/email/unsubscribe', () => {
  it('renders a confirm form for a valid token without mutating', async () => {
    const token = signUnsubscribeToken('a@b.com', 'weekly_digest')!
    const res = GET(new Request(url(token)))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<form method="post"')
    expect(body).toContain('Confirm unsubscribe')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('400s on an invalid token', async () => {
    const res = GET(new Request(url('garbage')))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('reflects the token category in the confirmation copy', async () => {
    const digest = await GET(new Request(url(signUnsubscribeToken('a@b.com', 'weekly_digest')!))).text()
    expect(digest).toContain('weekly digest emails')
    const reminders = await GET(new Request(url(signUnsubscribeToken('a@b.com', 'reminders')!))).text()
    expect(reminders).toContain('reminder emails')
  })
})

describe('POST /api/email/unsubscribe', () => {
  it('records the suppression for a valid token', async () => {
    const token = signUnsubscribeToken('A@B.com', 'weekly_digest')!
    const res = await POST(new Request(url(token), { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledOnce()
    const arg = upsertMock.mock.calls[0]![0]
    expect(arg).toMatchObject({ email: 'a@b.com', category: 'weekly_digest', source: 'user' })
  })

  it('400s and does not mutate on an invalid token', async () => {
    const res = await POST(new Request(url('garbage'), { method: 'POST' }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
