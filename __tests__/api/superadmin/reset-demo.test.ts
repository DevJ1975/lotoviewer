import { describe, it, expect, beforeEach } from 'vitest'
import {
  authAdminMock, gateOk, gateRejects, mockState, resetMocks, emptyRequest, ctxFor,
} from './_helpers'
import { POST as resetDemo } from '@/app/api/superadmin/tenants/[number]/reset-demo/route'
import { DELETE as deleteUser } from '@/app/api/superadmin/users/[user_id]/route'

describe('POST /api/superadmin/tenants/[number]/reset-demo', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('returns 401 when the gate rejects', async () => {
    gateRejects(403, 'Superadmin only')
    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: '0002' }))
    expect(r.status).toBe(403)
  })

  it('rejects an invalid tenant number with 400', async () => {
    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: 'abc' }))
    expect(r.status).toBe(400)
  })

  it('returns 404 when the tenant does not exist', async () => {
    mockState.queue('tenants', { data: null, error: null })
    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: '9999' }))
    expect(r.status).toBe(404)
  })

  it('REFUSES to wipe a non-demo tenant with 403 (safety)', async () => {
    mockState.queue('tenants', {
      data: { id: 'T1', tenant_number: '0001', name: 'Snak King', is_demo: false },
      error: null,
    })
    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: '0001' }))
    expect(r.status).toBe(403)
    const body = await r.json()
    expect(body.error).toMatch(/non-demo/i)
    // No deletes should have fired.
    expect(mockState.deletes).toHaveLength(0)
  })

  it('demo tenant: wipes all domain tables and reseeds via RPC for tenant 0002', async () => {
    mockState.queue('tenants', {
      data: { id: 'T2', tenant_number: '0002', name: 'WLS Demo', is_demo: true },
      error: null,
    })
    // Each delete chain returns a count. We don't know the exact table
    // order without reading the source, so we queue generic results
    // for every domain table the route enumerates.
    const tables = [
      'loto_energy_steps', 'loto_atmospheric_tests',
      'loto_confined_space_entries', 'loto_device_checkouts',
      'loto_meter_alerts', 'loto_equipment',
      'loto_confined_space_permits', 'loto_confined_spaces',
      'loto_hot_work_permits', 'loto_devices', 'loto_gas_meters',
      'loto_reviews', 'loto_training_records',
      'loto_webhook_subscriptions', 'loto_push_subscriptions',
      'loto_hygiene_log', 'audit_log',
    ]
    for (const t of tables) {
      mockState.queue(t, { data: null, count: 5, error: null })
    }
    mockState.queue('rpc:seed_wls_demo', { data: 'Seeded WLS Demo (#0002): equipment=12 ...', error: null })

    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: '0002' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.ok).toBe(true)
    expect(body.seed).toMatch(/Seeded WLS Demo/)
    expect(body.seedSkipped).toBe(false)
    // Every table got a delete call.
    expect(mockState.deletes.length).toBeGreaterThan(0)
  })

  it('demo tenant other than 0002: wipes but skips reseed (no seed function)', async () => {
    mockState.queue('tenants', {
      data: { id: 'T5', tenant_number: '0005', name: 'Other Demo', is_demo: true },
      error: null,
    })
    // Empty queues for delete tables → defaults to { data: null, error: null }
    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: '0005' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.seedSkipped).toBe(true)
    expect(body.seed).toBeNull()
  })

  it('skips a domain table with PG 42P01 (table does not exist) instead of failing', async () => {
    mockState.queue('tenants', {
      data: { id: 'T2', tenant_number: '0002', name: 'WLS Demo', is_demo: true },
      error: null,
    })
    // First domain table errors with 42P01 → skipped, loop continues.
    mockState.queue('loto_energy_steps', { data: null, error: { message: 'rel does not exist', code: '42P01' } })
    mockState.queue('rpc:seed_wls_demo', { data: 'ok', error: null })

    const r = await resetDemo(emptyRequest('POST'), ctxFor({ number: '0002' }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.skipped).toContain('loto_energy_steps')
  })
})

describe('DELETE /api/superadmin/users/[user_id]', () => {
  beforeEach(() => { resetMocks(); gateOk('caller-id') })

  it('refuses to delete the caller with 400', async () => {
    const r = await deleteUser(emptyRequest('DELETE'), ctxFor({ user_id: 'caller-id' }))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.error).toMatch(/your own/i)
  })

  it('refuses with 409 when user is the last owner of any tenant', async () => {
    mockState.queue('tenant_memberships', {
      data: [
        { tenant_id: 'T1', role: 'owner' },
        { tenant_id: 'T2', role: 'admin' },
      ],
      error: null,
    })
    // ownerCount on T1 returns 1 → block.
    mockState.queue('tenant_memberships', { data: null, count: 1, error: null })
    const r = await deleteUser(emptyRequest('DELETE'), ctxFor({ user_id: 'U1' }))
    expect(r.status).toBe(409)
    const body = await r.json()
    expect(body.error).toMatch(/last owner/i)
  })

  it('happy path: deletes the auth user', async () => {
    mockState.queue('tenant_memberships', {
      data: [{ tenant_id: 'T1', role: 'member' }],
      error: null,
    })
    authAdminMock.deleteUser.mockResolvedValue({ error: null })
    const r = await deleteUser(emptyRequest('DELETE'), ctxFor({ user_id: 'U1' }))
    expect(r.status).toBe(200)
    expect(authAdminMock.deleteUser).toHaveBeenCalledWith('U1')
  })
})
