// /api/environmental/health reports whether the opt-in Environmental module
// is on for the caller's tenant. It must enforce the tenant gate, read only
// the caller's own tenant row, and never leak a raw database error.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const gateMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (...a: unknown[]) => gateMock(...a),
}))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: () => Response.json({ error: 'internal' }, { status: 500 }),
}))

import { GET } from '@/app/api/environmental/health/route'

interface TenantQueryResult {
  data:  { modules: Record<string, boolean> | null } | null
  error: { message: string; code?: string } | null
}

// A minimal stand-in for the RLS-scoped client: records which tenant id the
// route filtered on and returns the canned row.
function authedClientReturning(result: TenantQueryResult) {
  const eq = vi.fn(() => ({ maybeSingle: async () => result }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from }, from, select, eq }
}

function req(): Request {
  return new Request('https://example.com/api/environmental/health')
}

beforeEach(() => gateMock.mockReset())

describe('GET /api/environmental/health', () => {
  it('passes an authentication failure through as 401', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 401, message: 'Missing bearer token' })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Missing bearer token' })
  })

  it('passes a membership failure (not a member of the requested tenant) through as 403', async () => {
    gateMock.mockResolvedValue({ ok: false, status: 403, message: 'Not a member of this tenant' })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Not a member of this tenant' })
  })

  it('reports enabled=false for a tenant with no override: the module is opt-in', async () => {
    const { client } = authedClientReturning({ data: { modules: {} }, error: null })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', authedClient: client })
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
  })

  it('reports enabled=true once the tenant has opted in', async () => {
    const { client } = authedClientReturning({ data: { modules: { environmental: true } }, error: null })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', authedClient: client })
    expect(await (await GET(req())).json()).toEqual({ enabled: true })
  })

  it('reports enabled=false when the tenant explicitly opted out', async () => {
    const { client } = authedClientReturning({ data: { modules: { environmental: false } }, error: null })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', authedClient: client })
    expect(await (await GET(req())).json()).toEqual({ enabled: false })
  })

  it('reports enabled=false when RLS hides the tenant row', async () => {
    const { client } = authedClientReturning({ data: null, error: null })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', authedClient: client })
    expect(await (await GET(req())).json()).toEqual({ enabled: false })
  })

  it('filters the tenants table on the gate-verified tenant id', async () => {
    const { client, from, eq } = authedClientReturning({ data: { modules: {} }, error: null })
    gateMock.mockResolvedValue({ ok: true, tenantId: 'gate-tenant', authedClient: client })
    await GET(req())
    expect(from).toHaveBeenCalledWith('tenants')
    expect(eq).toHaveBeenCalledWith('id', 'gate-tenant')
  })

  it('sanitizes a database error instead of leaking it', async () => {
    const { client } = authedClientReturning({ data: null, error: { message: 'relation "tenants" does not exist', code: '42P01' } })
    gateMock.mockResolvedValue({ ok: true, tenantId: 't1', authedClient: client })
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})
