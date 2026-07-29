import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Resend is class-instantiated (`new Resend(key)`), so the mock must be a real
// class, not vi.fn(). vi.hoisted lets the factory reference the spy + the
// mutable dedupe-claim result. See sendInvite.test.ts for the same pattern.
const { sendMock, claim, deleteMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  claim: { result: { data: { id: 'row-1' }, error: null } as { data: { id: string } | null; error: { code?: string } | null } },
  deleteMock: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
}))

vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock } } }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

// Chainable supabaseAdmin stub: `insert().select().single()` resolves the
// dedupe claim; bare `await insert()` (logEmailSend) and `update().eq()` resolve OK.
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve(claim.result) }),
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: deleteMock,
    }),
  }),
}))

import { sendEmail } from '@/lib/email/core'

const ORIG_ENV = process.env
const base = { kind: 'invite' as const, to: 'jane@example.com', subject: 'Hi', text: 'body' }

describe('sendEmail', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.RESEND_API_KEY = 'test-key'
    process.env.RESEND_RETRY_BASE_MS = '0' // instant retries — no sleeping in tests
    process.env.RESEND_PACE_MS = '0'
    sendMock.mockReset()
    sendMock.mockResolvedValue({ data: { id: 'msg-1' }, error: null })
    claim.result = { data: { id: 'row-1' }, error: null }
    deleteMock.mockClear()
  })
  afterEach(() => { process.env = ORIG_ENV })

  it('skips (no send) when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY
    const res = await sendEmail(base)
    expect(res).toEqual({ sent: false, providerId: null })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends and returns the provider id on success', async () => {
    const res = await sendEmail(base)
    expect(res).toEqual({ sent: true, providerId: 'msg-1' })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0][0]
    expect(payload.to).toBe('jane@example.com')
    expect(payload.subject).toBe('Hi')
    expect(payload.text).toBe('body')
    expect(payload.from).toContain('soteriafield.app')
  })

  it('does NOT retry a permanent rejection', async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'bad address' } })
    const res = await sendEmail(base)
    expect(res.sent).toBe(false)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('treats a legacy error object (no name/statusCode) as permanent', async () => {
    // Mirrors the existing sendInvite reject test shape — must not loop.
    sendMock.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const res = await sendEmail(base)
    expect(res.sent).toBe(false)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient 429 and succeeds', async () => {
    sendMock
      .mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'slow down' } })
      .mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'slow down' } })
      .mockResolvedValueOnce({ data: { id: 'msg-2' }, error: null })
    const res = await sendEmail(base)
    expect(res).toEqual({ sent: true, providerId: 'msg-2' })
    expect(sendMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after MAX_ATTEMPTS transient failures', async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: 'internal_server_error', statusCode: 500, message: 'oops' } })
    const res = await sendEmail(base)
    expect(res.sent).toBe(false)
    expect(sendMock).toHaveBeenCalledTimes(3)
  })

  it('retries a thrown network error then gives up', async () => {
    sendMock.mockRejectedValue(new Error('socket hang up'))
    const res = await sendEmail(base)
    expect(res.sent).toBe(false)
    expect(sendMock).toHaveBeenCalledTimes(3)
  })

  it('attaches RFC 8058 List-Unsubscribe headers when unsubscribeUrl is set', async () => {
    await sendEmail({ ...base, unsubscribeUrl: 'https://app/api/email/unsubscribe?token=abc' })
    const payload = sendMock.mock.calls[0][0]
    expect(payload.headers['List-Unsubscribe']).toBe('<https://app/api/email/unsubscribe?token=abc>')
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('skips the send when the dedupe claim is already held (idempotency)', async () => {
    claim.result = { data: null, error: { code: '23505' } } // unique_violation
    const res = await sendEmail({ ...base, dedupeKey: 'scorecard:t1:2026-06-15:jane@example.com' })
    expect(res).toEqual({ sent: false, providerId: null })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends when the dedupe claim is won', async () => {
    claim.result = { data: { id: 'row-9' }, error: null }
    const res = await sendEmail({ ...base, dedupeKey: 'scorecard:t1:2026-06-15:jane@example.com' })
    expect(res.sent).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('releases the dedupe key (delete) when a claimed send fails, so a later run can retry', async () => {
    claim.result = { data: { id: 'row-7' }, error: null } // claim won
    sendMock.mockResolvedValue({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'bad' } })
    const res = await sendEmail({ ...base, dedupeKey: 'scorecard:t1:2026-06-15:jane@example.com' })
    expect(res.sent).toBe(false)
    expect(sendMock).toHaveBeenCalledTimes(1) // it actually attempted — did not skip
    expect(deleteMock).toHaveBeenCalled()     // key released for a future retry
  })
})
