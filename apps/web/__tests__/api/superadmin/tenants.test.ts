import { describe, it, expect, beforeEach } from 'vitest'
import {
  gateOk, gateRejects, mockState, resetMocks, jsonRequest, ctxFor,
} from './_helpers'
import { POST as createTenant } from '@/app/api/superadmin/tenants/route'
import { GET as getTenant, PATCH as patchTenant } from '@/app/api/superadmin/tenants/[number]/route'

describe('POST /api/superadmin/tenants', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('returns 401 when the gate rejects', async () => {
    gateRejects(401, 'Missing bearer token')
    const res = await createTenant(jsonRequest('POST', { name: 'X', slug: 'x' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Missing bearer token' })
  })

  it('rejects an empty/oversize name with 400', async () => {
    const r1 = await createTenant(jsonRequest('POST', { name: '   ', slug: 'foo' }))
    expect(r1.status).toBe(400)
    const r2 = await createTenant(jsonRequest('POST', { name: 'X'.repeat(201), slug: 'foo' }))
    expect(r2.status).toBe(400)
  })

  it('rejects an invalid slug with 400', async () => {
    const r = await createTenant(jsonRequest('POST', { name: 'Acme', slug: 'AC' }))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toMatch(/slug/i)
  })

  it('returns 500 when next_tenant_number RPC fails', async () => {
    mockState.queue('rpc:next_tenant_number', { data: null, error: { message: 'seq broken' } })
    const r = await createTenant(jsonRequest('POST', { name: 'Acme', slug: 'acme' }))
    expect(r.status).toBe(500)
  })

  it('maps Postgres unique-violation (23505) on slug to 409', async () => {
    mockState.queue('rpc:next_tenant_number', { data: '0003', error: null })
    mockState.queue('tenants', { data: null, error: { message: 'dup', code: '23505' } })
    const r = await createTenant(jsonRequest('POST', { name: 'Acme', slug: 'acme' }))
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toMatch(/already taken/i)
  })

  it('happy path: allocates tenant_number, inserts, returns 201 with the new tenant', async () => {
    mockState.queue('rpc:next_tenant_number', { data: '0003', error: null })
    mockState.queue('tenants', {
      data: { id: 'T3', tenant_number: '0003', slug: 'acme', name: 'Acme', status: 'active', is_demo: false },
      error: null,
    })
    const r = await createTenant(jsonRequest('POST', {
      name: 'Acme',
      slug: 'acme',
      is_demo: false,
      modules: { loto: true, 'confined-spaces': false },
    }))
    expect(r.status).toBe(201)
    const body = await r.json()
    expect(body.tenant.tenant_number).toBe('0003')
    expect(body.tenant.slug).toBe('acme')

    // Creating a tenant also seeds its primary facility (migrations 209-211),
    // so the route performs two inserts: tenants + facilities. Assert against
    // the tenants insert specifically — its payload is the contract under test.
    const tenantInserts = mockState.inserts.filter(i => i.table === 'tenants')
    expect(tenantInserts).toHaveLength(1)
    const insert = tenantInserts[0]!.payload as Record<string, unknown>
    expect(insert.tenant_number).toBe('0003')
    expect(insert.slug).toBe('acme')
    expect((insert.modules as Record<string, unknown>).loto).toBe(true)
    expect((insert.modules as Record<string, unknown>)['confined-spaces']).toBe(false)
  })

  it('demo tenants get status=trial', async () => {
    mockState.queue('rpc:next_tenant_number', { data: '0003', error: null })
    mockState.queue('tenants', {
      data: { id: 'T3', tenant_number: '0003', slug: 'demo', name: 'Demo', status: 'trial', is_demo: true },
      error: null,
    })
    await createTenant(jsonRequest('POST', { name: 'Demo', slug: 'demo', is_demo: true }))
    const insert = mockState.inserts[0]!.payload as Record<string, unknown>
    expect(insert.status).toBe('trial')
    expect(insert.is_demo).toBe(true)
  })
})

describe('PATCH /api/superadmin/tenants/[number]', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('rejects an invalid tenant number in the URL with 400', async () => {
    const r = await patchTenant(jsonRequest('PATCH', { name: 'X' }), ctxFor({ number: 'abcd' }))
    expect(r.status).toBe(400)
  })

  it('returns 400 when no fields are present in the body', async () => {
    const r = await patchTenant(jsonRequest('PATCH', {}), ctxFor({ number: '0001' }))
    expect(r.status).toBe(400)
  })

  it('rejects invalid status with 400', async () => {
    const r = await patchTenant(jsonRequest('PATCH', { status: 'bogus' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(400)
  })

  it('mirrors disabled_at when status flips to disabled', async () => {
    mockState.queue('tenants', {
      data: { id: 'T1', tenant_number: '0001', status: 'disabled', disabled_at: 'now' },
      error: null,
    })
    const r = await patchTenant(jsonRequest('PATCH', { status: 'disabled' }), ctxFor({ number: '0001' }))
    expect(r.status).toBe(200)
    const update = mockState.updates[0]!.payload as Record<string, unknown>
    expect(update.status).toBe('disabled')
    expect(update.disabled_at).toEqual(expect.any(String))  // ISO timestamp set
  })

  it('clears disabled_at when status flips back to active', async () => {
    mockState.queue('tenants', {
      data: { id: 'T1', tenant_number: '0001', status: 'active', disabled_at: null },
      error: null,
    })
    await patchTenant(jsonRequest('PATCH', { status: 'active' }), ctxFor({ number: '0001' }))
    const update = mockState.updates[0]!.payload as Record<string, unknown>
    expect(update.status).toBe('active')
    expect(update.disabled_at).toBeNull()
  })

  it('returns 404 when the tenant_number does not exist', async () => {
    mockState.queue('tenants', { data: null, error: null })
    const r = await patchTenant(jsonRequest('PATCH', { name: 'X' }), ctxFor({ number: '9999' }))
    expect(r.status).toBe(404)
  })

  it('happy path: sends only the fields that were patched', async () => {
    mockState.queue('tenants', {
      data: { id: 'T1', tenant_number: '0001', name: 'New Name', is_demo: false },
      error: null,
    })
    const r = await patchTenant(
      jsonRequest('PATCH', { name: 'New Name', is_demo: false }),
      ctxFor({ number: '0001' }),
    )
    expect(r.status).toBe(200)
    const update = mockState.updates[0]!.payload as Record<string, unknown>
    expect(Object.keys(update).sort()).toEqual(['is_demo', 'name'])
    expect(update.name).toBe('New Name')
  })
})

// The tenant's own Anthropic key is a secret. It lives in tenant_secrets
// (service role only, migration 306) and must never travel in `settings`,
// which every member of the tenant can read.
describe('Anthropic API key handling (migration 306)', () => {
  const KEY = 'sk-ant-api03-' + 'k'.repeat(40)

  beforeEach(() => { resetMocks(); gateOk() })

  describe('PATCH', () => {
    it('rejects a key sent inside settings and writes nothing', async () => {
      const r = await patchTenant(
        jsonRequest('PATCH', { settings: { anthropic_api_key: KEY, other: 1 } }),
        ctxFor({ number: '0001' }),
      )
      expect(r.status).toBe(400)
      expect(mockState.updates).toHaveLength(0)
      expect(mockState.upserts).toHaveLength(0)
    })

    it('stores a key-only change in tenant_secrets, trimmed, attributed to the superadmin', async () => {
      mockState.queue('tenants', { data: { id: 'T1', tenant_number: '0001' }, error: null })
      const r = await patchTenant(jsonRequest('PATCH', { anthropic_api_key: `  ${KEY}\n` }), ctxFor({ number: '0001' }))
      expect(r.status).toBe(200)
      expect(mockState.updates).toHaveLength(0)  // no tenants columns changed
      expect(mockState.upserts).toHaveLength(1)
      expect(mockState.upserts[0]).toMatchObject({
        table:   'tenant_secrets',
        payload: { tenant_id: 'T1', anthropic_api_key: KEY, updated_by: 'super-1' },
        options: { onConflict: 'tenant_id' },
      })
    })

    it('removes the override when the field is null', async () => {
      mockState.queue('tenants', { data: { id: 'T1' }, error: null })
      const r = await patchTenant(jsonRequest('PATCH', { anthropic_api_key: null }), ctxFor({ number: '0001' }))
      expect(r.status).toBe(200)
      expect(mockState.upserts[0]!.payload).toMatchObject({ tenant_id: 'T1', anthropic_api_key: null })
    })

    it.each([
      ['empty string (could wipe a working key by accident)', ''],
      ['whitespace only', '   '],
      ['a number', 42],
      ['wrong prefix', 'OPENAI-' + 'x'.repeat(40)],
      ['truncated', 'sk-ant-short'],
    ])('rejects %s and writes nothing', async (_label, value) => {
      const r = await patchTenant(jsonRequest('PATCH', { anthropic_api_key: value }), ctxFor({ number: '0001' }))
      expect(r.status).toBe(400)
      expect(mockState.updates).toHaveLength(0)
      expect(mockState.upserts).toHaveLength(0)
    })

    it('applies tenant columns and the key together', async () => {
      mockState.queue('tenants', { data: { id: 'T1', name: 'New' }, error: null })
      const r = await patchTenant(jsonRequest('PATCH', { name: 'New', anthropic_api_key: KEY }), ctxFor({ number: '0001' }))
      expect(r.status).toBe(200)
      expect(Object.keys(mockState.updates[0]!.payload as object)).toEqual(['name'])
      expect(mockState.upserts).toHaveLength(1)
    })

    it('never echoes the key back', async () => {
      mockState.queue('tenants', { data: { id: 'T1', settings: {} }, error: null })
      const r = await patchTenant(jsonRequest('PATCH', { anthropic_api_key: KEY }), ctxFor({ number: '0001' }))
      expect(JSON.stringify(await r.json())).not.toContain(KEY)
    })

    it('does not write a key for a tenant that does not exist', async () => {
      mockState.queue('tenants', { data: null, error: null })
      const r = await patchTenant(jsonRequest('PATCH', { anthropic_api_key: KEY }), ctxFor({ number: '9999' }))
      expect(r.status).toBe(404)
      expect(mockState.upserts).toHaveLength(0)
    })

    it('reports a failed key write instead of claiming success', async () => {
      mockState.queue('tenants', { data: { id: 'T1' }, error: null })
      mockState.queue('tenant_secrets', { data: null, error: { message: 'boom' } })
      const r = await patchTenant(jsonRequest('PATCH', { anthropic_api_key: KEY }), ctxFor({ number: '0001' }))
      expect(r.status).toBe(500)
      const body = await r.json() as { error: string }
      expect(body.error).toMatch(/API key could not be saved/)
      expect(JSON.stringify(body)).not.toContain('boom')  // no raw DB error to the client
    })
  })

  describe('GET', () => {
    it('returns 401 when the gate rejects', async () => {
      gateRejects(401, 'nope')
      expect((await getTenant(jsonRequest('GET'), ctxFor({ number: '0001' }))).status).toBe(401)
    })

    it('rejects an invalid tenant number', async () => {
      expect((await getTenant(jsonRequest('GET'), ctxFor({ number: 'abcd' }))).status).toBe(400)
    })

    it('returns 404 for an unknown tenant', async () => {
      mockState.queue('tenants', { data: null, error: null })
      expect((await getTenant(jsonRequest('GET'), ctxFor({ number: '9999' }))).status).toBe(404)
    })

    it('reports configured + last four characters, never the key', async () => {
      mockState.queue('tenants', { data: { id: 'T1' }, error: null })
      mockState.queue('tenant_secrets', { data: { anthropic_api_key: KEY }, error: null })
      const r = await getTenant(jsonRequest('GET'), ctxFor({ number: '0001' }))
      expect(r.status).toBe(200)
      const text = JSON.stringify(await r.json())
      expect(JSON.parse(text)).toEqual({ anthropic_key: { configured: true, last4: 'kkkk' } })
      expect(text).not.toContain(KEY)
    })

    it('reports not configured when the tenant has no key', async () => {
      mockState.queue('tenants', { data: { id: 'T1' }, error: null })
      mockState.queue('tenant_secrets', { data: null, error: null })
      const r = await getTenant(jsonRequest('GET'), ctxFor({ number: '0001' }))
      expect(await r.json()).toEqual({ anthropic_key: { configured: false, last4: null } })
    })

    it('treats a blank stored key as not configured', async () => {
      mockState.queue('tenants', { data: { id: 'T1' }, error: null })
      mockState.queue('tenant_secrets', { data: { anthropic_api_key: '   ' }, error: null })
      const r = await getTenant(jsonRequest('GET'), ctxFor({ number: '0001' }))
      expect(await r.json()).toEqual({ anthropic_key: { configured: false, last4: null } })
    })
  })
})
