import { describe, it, expect, beforeEach, vi } from 'vitest'

// Locks the tenant-isolation contract of POST /api/hazardous-waste/containers:
// a container may only be linked to a stream that belongs to the caller's
// active tenant. The insert runs through the service-role client (RLS
// bypassed), so the route MUST verify the stream's tenant itself — a missing
// check would let a member link a container to another tenant's stream and
// read its name/waste codes back from the embedded join.

// ── gate mock ─────────────────────────────────────────────────────────────
const requireTenantModuleMemberMock = vi.fn()
vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: (...args: unknown[]) => requireTenantModuleMemberMock(...args),
}))

// ── supabaseAdmin mock ────────────────────────────────────────────────────
// Per-table result queue; every chain method returns the chain and the
// terminal (single/maybeSingle/then) resolves to the next queued result.
// Inserts are captured so we can assert NO write happened on rejection.
interface ChainResult { data?: unknown; error?: { message: string; code?: string } | null }
const queues = new Map<string, ChainResult[]>()
const inserts: Array<{ table: string; payload: unknown }> = []

function queue(table: string, ...results: ChainResult[]) {
  if (!queues.has(table)) queues.set(table, [])
  queues.get(table)!.push(...results)
}
function nextFor(table: string): ChainResult {
  const q = queues.get(table)
  return q && q.length ? q.shift()! : { data: null, error: null }
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const result = () => Promise.resolve(nextFor(table))
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq:     () => chain,
        is:     () => chain,
        order:  () => chain,
        insert: (payload: unknown) => { inserts.push({ table, payload }); return chain },
        single: result,
        maybeSingle: result,
        then: (onFulfilled: (v: ChainResult) => unknown) => Promise.resolve(nextFor(table)).then(onFulfilled),
      }
      return chain
    },
  }),
}))

import { POST } from '@/app/api/hazardous-waste/containers/route'

const TENANT = '11111111-1111-1111-1111-111111111111'
const STREAM = '22222222-2222-2222-2222-222222222222'

function postContainer(body: unknown): Request {
  return new Request('http://x/api/hazardous-waste/containers', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t', 'x-active-tenant': TENANT },
    body:    JSON.stringify(body),
  })
}

const validBody = {
  stream_id: STREAM,
  label:     'Drum 1',
  area_type: 'satellite_accumulation',
  status:    'open',
}

beforeEach(() => {
  requireTenantModuleMemberMock.mockReset()
  requireTenantModuleMemberMock.mockResolvedValue({
    ok: true, userId: 'user-1', userEmail: 'u@x.com', tenantId: TENANT,
    facilityId: null, role: 'member',
  })
  queues.clear()
  inserts.length = 0
})

describe('POST /api/hazardous-waste/containers — tenant scoping', () => {
  it('rejects a stream_id outside the active tenant with 404 and does not insert', async () => {
    // The tenant-scoped lookup finds nothing (the stream belongs to another
    // tenant, so the .eq(tenant_id) filter excludes it).
    queue('hazardous_waste_streams', { data: null, error: null })

    const res = await POST(postContainer(validBody))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Stream not found' })
    // Critically: the container row was never written.
    expect(inserts.find(i => i.table === 'hazardous_waste_containers')).toBeUndefined()
  })

  it('rejects an archived stream with 409', async () => {
    queue('hazardous_waste_streams', { data: { id: STREAM, archived_at: '2026-01-01' }, error: null })
    const res = await POST(postContainer(validBody))
    expect(res.status).toBe(409)
    expect(inserts.find(i => i.table === 'hazardous_waste_containers')).toBeUndefined()
  })

  it('rejects a non-UUID stream_id with 400 before any lookup', async () => {
    const res = await POST(postContainer({ ...validBody, stream_id: 'not-a-uuid' }))
    expect(res.status).toBe(400)
    expect(queues.get('hazardous_waste_streams')).toBeUndefined()
  })

  it('inserts the container with the gate tenant when the stream is in-tenant', async () => {
    queue('hazardous_waste_streams', { data: { id: STREAM, archived_at: null }, error: null })
    queue('hazardous_waste_containers', { data: { id: 'C1', stream_id: STREAM, tenant_id: TENANT }, error: null })

    const res = await POST(postContainer(validBody))

    expect(res.status).toBe(201)
    const write = inserts.find(i => i.table === 'hazardous_waste_containers')
    expect(write).toBeDefined()
    expect((write!.payload as { tenant_id: string }).tenant_id).toBe(TENANT)
  })

  it('returns the gate failure status when the caller is not a tenant member', async () => {
    requireTenantModuleMemberMock.mockResolvedValue({ ok: false, status: 403, message: 'Not a member of this tenant' })
    const res = await POST(postContainer(validBody))
    expect(res.status).toBe(403)
    expect(inserts.length).toBe(0)
  })
})
