import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUser = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}))

const upsert = vi.fn()
const deleteEq = vi.fn()
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      upsert: (...a: unknown[]) => upsert(...a),
      delete: () => ({ eq: (...a: unknown[]) => { deleteEq(...a); return { eq: () => ({ error: null }) } } }),
    }),
  }),
}))

import { POST, DELETE } from '@/app/api/push/expo-token/route'

const TOKEN  = 'ExponentPushToken[abc123]'
const TENANT = '11111111-1111-4111-8111-111111111111'

function req(method: string, body?: unknown, headers: Record<string, string> = { authorization: 'Bearer jwt' }): Request {
  return new Request('https://example.com/api/push/expo-token', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  getUser.mockReset()
  upsert.mockReset().mockResolvedValue({ error: null })
  deleteEq.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})

describe('POST /api/push/expo-token', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await POST(req('POST', { token: TOKEN, platform: 'ios' }, {}))
    expect(res.status).toBe(401)
  })

  it('rejects a token that is not an Expo push token', async () => {
    const res = await POST(req('POST', { token: 'abc', platform: 'ios' }))
    expect(res.status).toBe(400)
  })

  it('rejects an unknown platform', async () => {
    const res = await POST(req('POST', { token: TOKEN, platform: 'web' }))
    expect(res.status).toBe(400)
  })

  it('upserts on token, owned by the caller, with the active tenant', async () => {
    const res = await POST(req('POST', { token: TOKEN, platform: 'android' }, {
      authorization: 'Bearer jwt', 'x-active-tenant': TENANT,
    }))
    expect(res.status).toBe(200)
    const [row, opts] = upsert.mock.calls[0]!
    expect(row).toMatchObject({ profile_id: 'u1', tenant_id: TENANT, token: TOKEN, platform: 'android' })
    expect(opts).toEqual({ onConflict: 'token' })
  })

  it('drops a malformed tenant header instead of failing', async () => {
    const res = await POST(req('POST', { token: TOKEN, platform: 'ios' }, {
      authorization: 'Bearer jwt', 'x-active-tenant': 'not-a-uuid',
    }))
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0]![0]).toMatchObject({ tenant_id: null })
  })
})

describe('DELETE /api/push/expo-token', () => {
  it('requires a token in the body', async () => {
    expect((await DELETE(req('DELETE', {}))).status).toBe(400)
  })

  it('scopes the delete to the caller', async () => {
    const res = await DELETE(req('DELETE', { token: TOKEN }))
    expect(res.status).toBe(200)
    expect(deleteEq).toHaveBeenCalledWith('profile_id', 'u1')
  })
})
