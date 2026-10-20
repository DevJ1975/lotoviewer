import { beforeEach, describe, expect, it, vi } from 'vitest'

// The LRS secret is write-only: no response returns it, and it must never be
// sent anywhere but the endpoint it was saved for.

const { saved, tested, upserts } = vi.hoisted(() => ({
  saved: { current: null as null | { endpoint: string; auth_username: string; auth_password: string } },
  tested: [] as Array<{ endpoint: string; auth_password: string }>,
  upserts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/strike/gate', () => ({
  requireStrikeAdmin: async () => ({ ok: true, tenantId: 'tenant-1', userId: 'admin-1', role: 'admin' }),
}))
vi.mock('@/lib/strike/lrs', () => ({
  MAX_TRIES: 8,
  lrsEndpointProblem: async () => null,
  testLrsConnection: async (creds: { endpoint: string; auth_password: string }) => { tested.push(creds); return { ok: true, message: 'Connected.' } },
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: saved.current, error: null })
      chain.upsert = async (row: Record<string, unknown>) => { upserts.push(row); return { error: null } }
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve)
      return chain
    },
  }),
}))

import { POST, PUT } from '@/app/api/strike/lrs/route'

const call = (handler: (r: Request) => Promise<Response>, body: unknown) =>
  handler(new Request('http://x/api/strike/lrs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  saved.current = { endpoint: 'https://lrs.example.com/xapi/', auth_username: 'key', auth_password: 'saved-secret' }
  tested.length = 0
  upserts.length = 0
})

describe('the saved LRS secret', () => {
  it('is reused to test or re-save the endpoint it was saved for', async () => {
    await call(POST, { action: 'test', endpoint: 'https://lrs.example.com/xapi/v2/' })
    expect(tested[0].auth_password).toBe('saved-secret')
    await call(PUT, { endpoint: 'https://lrs.example.com/xapi/', username: 'key' })
    expect(upserts[0].auth_password).toBe('saved-secret')
  })

  it('is never sent to a different host', async () => {
    const res = await call(POST, { action: 'test', endpoint: 'https://collector.attacker.example/xapi/' })
    expect(await res.json()).toMatchObject({ ok: false })
    expect(tested).toEqual([])
  })

  it('is not carried over when the endpoint moves to a different host', async () => {
    const res = await call(PUT, { endpoint: 'https://collector.attacker.example/xapi/', username: 'key' })
    expect(res.status).toBe(400)
    expect(upserts).toEqual([])
  })
})
