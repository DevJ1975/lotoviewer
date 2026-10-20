import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  gate: vi.fn(),
  inserts: [] as Record<string, unknown>[],
  selects: [] as string[],
  filters: [] as [string, unknown][],
  insertResult: { data: null as unknown, error: null as { message: string } | null },
  updateResult: { data: null as unknown, error: null as { message: string } | null },
  listResult: { data: [] as unknown[], error: null as { message: string } | null },
}))

vi.mock('@/lib/strike/gate', () => ({ requireStrikeAdmin: () => h.gate() }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = (cols: string) => { h.selects.push(cols); return chain }
      chain.eq = (c: string, v: unknown) => { h.filters.push([c, v]); return chain }
      chain.is = (c: string, v: unknown) => { h.filters.push([c, v]); return chain }
      chain.order = () => chain
      chain.insert = (payload: Record<string, unknown>) => { h.inserts.push(payload); return chain }
      chain.update = () => chain
      chain.single = async () => h.insertResult
      chain.maybeSingle = async () => h.updateResult
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(h.listResult).then(resolve)
      return chain
    },
  }),
}))

import { GET, POST } from '@/app/api/strike/devices/route'
import { DELETE } from '@/app/api/strike/devices/[deviceId]/route'
import { hashDeviceSecret, parseDeviceCredential } from '@/lib/strike/deviceAuth'

const DEVICE_ID = '3f1c2b9e-7a4d-4e1b-9c2a-1b2c3d4e5f60'
const admin = { ok: true, tenantId: 't1', userId: 'admin-1', role: 'admin' }

const post = (body: unknown) => POST(new Request('http://x/api/strike/devices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const del = (id: string) => DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ deviceId: id }) })

beforeEach(() => {
  globalThis.__soteriaMemoryRateLimits = new Map()
  h.gate.mockReset().mockResolvedValue(admin)
  h.inserts.length = 0; h.selects.length = 0; h.filters.length = 0
  h.insertResult = { data: { id: DEVICE_ID, name: 'Line 3', department: null, site_label: null, created_at: 'now', last_seen_at: null, revoked_at: null }, error: null }
  h.updateResult = { data: { id: DEVICE_ID }, error: null }
  h.listResult = { data: [], error: null }
})

describe('POST /api/strike/devices', () => {
  it('shows the secret once and stores only its hash', async () => {
    const res = await post({ name: '  Line 3  ', department: 'Packaging' })
    expect(res.status).toBe(201)
    const { credential, device } = await res.json()

    const parsed = parseDeviceCredential(credential)!
    expect(parsed.deviceId).toBe(DEVICE_ID)
    const stored = h.inserts[0]
    expect(stored).toMatchObject({ tenant_id: 't1', name: 'Line 3', department: 'Packaging', site_label: null, enrolled_by: 'admin-1' })
    expect(stored.secret_hash).toBe(hashDeviceSecret(parsed.secret))
    expect(JSON.stringify(stored)).not.toContain(parsed.secret)
    expect(JSON.stringify(device)).not.toContain('secret')
  })

  it.each([['a viewer', { ok: false, status: 403, message: 'Tenant admin or owner required' }], ['a signed-out caller', { ok: false, status: 401, message: 'Missing bearer token' }]])('refuses %s', async (_l, g) => {
    h.gate.mockResolvedValue(g)
    expect((await post({ name: 'x' })).status).toBe(g.status)
    expect(h.inserts).toEqual([])
  })

  it('refuses a blank or oversized name and an unusable label', async () => {
    for (const body of [{ name: '   ' }, {}, { name: 'x'.repeat(81) }, { name: 'ok', department: 5 }, { name: 'ok', site_label: 'y'.repeat(81) }]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(h.inserts).toEqual([])
  })

  it('does not leak database error text', async () => {
    h.insertResult = { data: null, error: { message: 'relation "strike_devices" does not exist' } }
    const res = await post({ name: 'Line 3' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
  })
})

describe('GET /api/strike/devices', () => {
  it('lists the tenant’s tablets without ever selecting the secret hash', async () => {
    h.listResult = { data: [{ id: DEVICE_ID, name: 'Line 3' }], error: null }
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ devices: [{ id: DEVICE_ID, name: 'Line 3' }] })
    expect(h.selects[0]).not.toContain('secret')
    expect(h.filters).toContainEqual(['tenant_id', 't1'])
  })
})

describe('DELETE /api/strike/devices/[deviceId]', () => {
  it('revokes only this tenant’s still-active device', async () => {
    expect((await del(DEVICE_ID)).status).toBe(204)
    expect(h.filters).toEqual(expect.arrayContaining([['id', DEVICE_ID], ['tenant_id', 't1'], ['revoked_at', null]]))
  })

  it('answers 404 for a device that is not theirs or is already revoked', async () => {
    h.updateResult = { data: null, error: null }
    expect((await del(DEVICE_ID)).status).toBe(404)
  })

  it('refuses a malformed id and a non-admin', async () => {
    expect((await del('not-a-uuid')).status).toBe(400)
    h.gate.mockResolvedValue({ ok: false, status: 403, message: 'Tenant admin or owner required' })
    expect((await del(DEVICE_ID)).status).toBe(403)
  })
})
