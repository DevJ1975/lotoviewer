import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), sync: vi.fn(), sentry: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/strike/offlineCaller', () => ({ authenticateOfflineCaller: () => h.auth() }))
vi.mock('@/lib/strike/offlineSync', () => ({ syncOfflineAttempt: (...a: unknown[]) => h.sync(...a) }))
vi.mock('@sentry/nextjs', () => ({ captureException: h.sentry, captureMessage: vi.fn() }))

import { POST } from '@/app/api/strike/offline/sync/route'

const caller = { tenantId: 't1', device: { id: 'dev-1' }, user: null }
const ok = { ok: true, caller, keyScope: 'dev-1', rateKey: 'device:dev-1' }
const post = (body: unknown) => POST(new Request('http://x/api/strike/offline/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }))
const synced = (id: string) => ({ client_attempt_id: id, status: 'synced', attempt_id: `att-${id}`, submitted: true, passed: true, score_percent: 100 })

beforeEach(() => {
  globalThis.__soteriaMemoryRateLimits = new Map()
  h.auth.mockReset().mockResolvedValue(ok)
  h.sync.mockReset().mockImplementation(async (_a, _c, raw: { client_attempt_id: string }) => synced(raw.client_attempt_id))
  h.sentry.mockReset()
})

describe('POST /api/strike/offline/sync', () => {
  it('answers every attempt separately, in order', async () => {
    const res = await post({ attempts: [{ client_attempt_id: 'a' }, { client_attempt_id: 'b' }] })
    expect(res.status).toBe(200)
    expect((await res.json()).results.map((r: { client_attempt_id: string }) => r.client_attempt_id)).toEqual(['a', 'b'])
    expect(h.sync.mock.calls[0][1]).toBe(caller)
  })

  it('one attempt failing transiently says "retry" for it and still syncs the rest', async () => {
    h.sync.mockImplementation(async (_a, _c, raw: { client_attempt_id: string }) => {
      if (raw.client_attempt_id === 'b') throw new Error('connection reset')
      return synced(raw.client_attempt_id)
    })
    const res = await post({ attempts: [{ client_attempt_id: 'a' }, { client_attempt_id: 'b' }, { client_attempt_id: 'c' }] })
    const { results } = await res.json()
    expect(results.map((r: { status: string }) => r.status)).toEqual(['synced', 'retry', 'synced'])
    expect(results[1].client_attempt_id).toBe('b')
    expect(JSON.stringify(results[1])).not.toContain('connection reset')
    expect(h.sentry).toHaveBeenCalledOnce()
  })

  it('refuses a bad credential before reading any attempt, and says why a revoked tablet was refused', async () => {
    h.auth.mockResolvedValue({ ok: false, status: 401, message: 'This device was removed.', code: 'device_revoked' })
    const res = await post({ attempts: [{ client_attempt_id: 'a' }] })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'This device was removed.', code: 'device_revoked' })
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('refuses malformed bodies and oversized batches', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ attempts: [] })).status).toBe(400)
    expect((await post({ attempts: Array.from({ length: 26 }, (_, i) => ({ client_attempt_id: `a${i}` })) })).status).toBe(400)
    expect(h.sync).not.toHaveBeenCalled()
  })

  it('rate-limits per device, so a plant’s shared address does not lock every tablet out', async () => {
    for (let i = 0; i < 60; i++) expect((await post({ attempts: [{ client_attempt_id: 'a' }] })).status).toBe(200)
    expect((await post({ attempts: [{ client_attempt_id: 'a' }] })).status).toBe(429)

    h.auth.mockResolvedValue({ ...ok, rateKey: 'device:dev-2' })
    expect((await post({ attempts: [{ client_attempt_id: 'a' }] })).status).toBe(200)
  })
})
