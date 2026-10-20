// POST /api/superadmin/queries/run
//
// The SQL runner's own superadmin check reads auth.uid(), so the RPC has to
// run as the caller. Through the service-role client auth.uid() is null and
// exec_readonly_sql refuses every call with 42501 — which is how the route
// behaved before this test existed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gateOk, gateRejects, jsonRequest, mockState, resetMocks } from './_helpers'

const { createClientMock, rpcMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  rpcMock:          vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => {
    createClientMock(...args)
    return { rpc: rpcMock }
  },
}))

import { POST } from '@/app/api/superadmin/queries/run/route'

describe('POST /api/superadmin/queries/run', () => {
  beforeEach(() => {
    resetMocks()
    createClientMock.mockReset()
    rpcMock.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    gateOk()
  })

  it('runs the query as the caller, carrying their bearer token, not as service role', async () => {
    rpcMock.mockResolvedValue({ data: [{ n: 1 }, { n: 2 }], error: null })

    const res = await POST(jsonRequest('POST', { sql: 'select 1 as n', max_rows: 10 }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rows: [{ n: 1 }, { n: 2 }], rowCount: 2, truncated: false, maxRows: 10 })

    const [url, key, options] = createClientMock.mock.calls[0]! as [string, string, { global: { headers: Record<string, string> } }]
    expect(url).toBe('https://x.supabase.co')
    expect(key).toBe('anon')
    expect(options.global.headers.Authorization).toBe('Bearer t')
    expect(rpcMock).toHaveBeenCalledWith('exec_readonly_sql', { sql_text: 'select 1 as n', max_rows: 10 })
    // Nothing went through the service-role client.
    expect(mockState.rpcCalls).toEqual([])
  })

  it('refuses a non-superadmin before touching the database', async () => {
    gateRejects(403, 'Superadmin only')

    const res = await POST(jsonRequest('POST', { sql: 'select 1' }))

    expect(res.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rejects anything that does not lead with SELECT, WITH or EXPLAIN', async () => {
    const res = await POST(jsonRequest('POST', { sql: 'delete from tenants' }))

    expect(res.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('clamps max_rows into [1, 5000] and reports truncation at the cap', async () => {
    rpcMock.mockResolvedValue({ data: Array.from({ length: 5000 }, (_, i) => ({ i })), error: null })

    const res = await POST(jsonRequest('POST', { sql: 'select 1', max_rows: 999_999 }))

    expect(res.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith('exec_readonly_sql', { sql_text: 'select 1', max_rows: 5000 })
    expect(await res.json()).toMatchObject({ maxRows: 5000, truncated: true })
  })

  it('surfaces a database refusal as a 400 with the Postgres code', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'exec_readonly_sql requires superadmin', code: '42501', details: null } })

    const res = await POST(jsonRequest('POST', { sql: 'select 1' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: '42501' })
  })
})
