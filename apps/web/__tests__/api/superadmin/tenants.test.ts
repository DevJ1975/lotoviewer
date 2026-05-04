import { describe, it, expect, beforeEach } from 'vitest'
import {
  gateOk, gateRejects, mockState, resetMocks, jsonRequest, ctxFor,
} from './_helpers'
import { POST as createTenant } from '@/app/api/superadmin/tenants/route'
import { PATCH as patchTenant } from '@/app/api/superadmin/tenants/[number]/route'

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

    // Insert payload should carry the allocated number + sanitized modules.
    expect(mockState.inserts).toHaveLength(1)
    const insert = mockState.inserts[0]!.payload as Record<string, unknown>
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
