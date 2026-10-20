import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}))

const insertResult = vi.fn()
const pendingResult = vi.fn()
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (row: unknown) => ({ select: () => ({ single: () => insertResult(row) }) }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => pendingResult() }) }) }),
    }),
  }),
}))

const sendEmail = vi.fn()
vi.mock('@/lib/email/sendAccountDeletionRequest', () => ({
  sendAccountDeletionRequestEmail: (...a: unknown[]) => sendEmail(...a),
}))

import { POST } from '@/app/api/users/me/deletion-request/route'

function req(body?: unknown, headers: Record<string, string> = { authorization: 'Bearer jwt' }): Request {
  return new Request('https://example.com/api/users/me/deletion-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } }, error: null })
  insertResult.mockReset().mockResolvedValue({ data: { id: 'r1', requested_at: '2026-10-20T00:00:00Z' }, error: null })
  pendingResult.mockReset().mockResolvedValue({ data: { id: 'r0', requested_at: '2026-10-01T00:00:00Z' } })
  sendEmail.mockReset().mockResolvedValue(true)
})

describe('POST /api/users/me/deletion-request', () => {
  it('requires authentication', async () => {
    expect((await POST(req({}, {}))).status).toBe(401)
    expect(insertResult).not.toHaveBeenCalled()
  })

  it('records the request, notifies support, and returns 201', async () => {
    const res = await POST(req({ reason: '  leaving the company  ' }))
    expect(res.status).toBe(201)
    expect(insertResult).toHaveBeenCalledWith({ user_id: 'u1', email: 'a@b.co', reason: 'leaving the company' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ status: 'pending', alreadyRequested: false })
  })

  it('accepts an empty body (the reason is optional)', async () => {
    const res = await POST(req())
    expect(res.status).toBe(201)
    expect(insertResult).toHaveBeenCalledWith({ user_id: 'u1', email: 'a@b.co', reason: null })
  })

  it('rejects an over-long reason', async () => {
    expect((await POST(req({ reason: 'x'.repeat(1001) }))).status).toBe(400)
  })

  it('rejects a non-text reason', async () => {
    expect((await POST(req({ reason: 42 }))).status).toBe(400)
  })

  it('is idempotent: a pending request returns 200 and sends no second email', async () => {
    insertResult.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate' } })
    const res = await POST(req({}))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyRequested: true, requestedAt: '2026-10-01T00:00:00Z' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('surfaces other database failures as 500', async () => {
    insertResult.mockResolvedValue({ data: null, error: { code: '50000', message: 'boom' } })
    expect((await POST(req({}))).status).toBe(500)
  })
})
