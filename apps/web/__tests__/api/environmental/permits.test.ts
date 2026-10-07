import { describe, it, expect, beforeEach } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params,
  TENANT, FACILITY, OTHER_FACILITY, USER,
} from './_harness'
import { GET, POST } from '@/app/api/environmental/permits/route'
import { PATCH, DELETE } from '@/app/api/environmental/permits/[id]/route'

const PERMIT_ID = 'f0000000-0000-0000-0000-000000000001'

const permitRow = (over: Record<string, unknown> = {}) => ({
  id: PERMIT_ID, tenant_id: TENANT, facility_id: FACILITY, program: 'stormwater', permit_type: 'CA IGP', permit_number: 'WDID-1',
  issuing_agency: null, jurisdiction: 'CA', status: 'active', effective_date: '2025-07-01', expiration_date: '2030-06-30',
  renewal_lead_days: 180, identifiers: {}, conditions: [], document_path: null, notes: null, ...over,
})

const validBody = (over: Record<string, unknown> = {}) => ({
  program: 'stormwater', permit_type: 'CA IGP', permit_number: 'WDID-1', status: 'active', expiration_date: '2030-06-30', ...over,
})

beforeEach(resetGates)

describe('GET /api/environmental/permits', () => {
  it('passes a gate refusal straight through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    const res = await GET(jsonRequest('/api/environmental/permits', 'GET'))
    expect(res.status).toBe(403)
  })

  it('lists the active site\'s permits, each with its health', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: [permitRow({ expiration_date: '2020-01-01' }), permitRow({ id: 'p2', status: 'draft' })] }] })
    allow(memberGate, db.client, { role: 'member' })
    const res = await GET(jsonRequest('/api/environmental/permits', 'GET'))
    const body = await res.json()
    expect(db.filtered('environmental_permits', 'facility_id', FACILITY)).toBe(true)
    expect(db.filtered('environmental_permits', 'tenant_id', TENANT)).toBe(true)
    expect(body.permits.map((p: { health: string }) => p.health)).toEqual(['expired', 'not_tracked'])
  })

  it('lets ?facility_id choose the site, and shows every site in roll-up mode', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: [] }] })
    allow(memberGate, db.client, { facilityId: null })
    await GET(jsonRequest(`/api/environmental/permits?facility_id=${OTHER_FACILITY}`, 'GET'))
    expect(db.filtered('environmental_permits', 'facility_id', OTHER_FACILITY)).toBe(true)

    const rollup = fakeSupabase({ environmental_permits: [{ data: [] }] })
    allow(memberGate, rollup.client, { facilityId: null })
    await GET(jsonRequest('/api/environmental/permits', 'GET'))
    expect(rollup.calls[0]!.ops.some(o => o.method === 'eq' && o.args[0] === 'facility_id')).toBe(false)
  })

  it('rejects a malformed facility id', async () => {
    allow(memberGate, fakeSupabase().client)
    expect((await GET(jsonRequest('/api/environmental/permits?facility_id=nope', 'GET'))).status).toBe(400)
  })

  it('answers 500 without leaking the database error', async () => {
    allow(memberGate, fakeSupabase({ environmental_permits: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await GET(jsonRequest('/api/environmental/permits', 'GET'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/permits', () => {
  it('is for tenant admins: a refusal from the admin gate stops it before any query', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await POST(jsonRequest('/api/environmental/permits', 'POST', validBody()))).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects malformed JSON and an invalid permit, listing every problem', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    const bad = await POST(new Request('https://example.com/x', { method: 'POST', body: '{' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_json')

    const res = await POST(jsonRequest('/api/environmental/permits', 'POST', { program: 'nonsense', expiration_date: 'soon' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid')
    expect(body.details.length).toBeGreaterThan(1)
    expect(db.calls).toEqual([])
  })

  it('refuses a document path in another tenant\'s folder', async () => {
    allow(adminGate, fakeSupabase().client)
    const res = await POST(jsonRequest('/api/environmental/permits', 'POST', validBody({ document_path: '22222222-2222-2222-2222-222222222222/x.pdf' })))
    expect(res.status).toBe(400)
  })

  it('creates the permit on the active site and stamps who made it', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: permitRow() }], compliance_calendar_obligations: [{ data: null }] })
    allow(adminGate, db.client)
    const res = await POST(jsonRequest('/api/environmental/permits', 'POST', validBody()))
    expect(res.status).toBe(201)
    expect(db.arg('environmental_permits', 'insert')).toMatchObject({
      tenant_id: TENANT, facility_id: FACILITY, created_by: USER, updated_by: USER, program: 'stormwater', renewal_lead_days: 180,
    })
  })

  it('puts a renewal deadline on the calendar for a permit in force, 180 days before it expires', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: permitRow() }], compliance_calendar_obligations: [{ data: null }] })
    allow(adminGate, db.client)
    await POST(jsonRequest('/api/environmental/permits', 'POST', validBody()))
    expect(db.arg('compliance_calendar_obligations', 'insert')).toMatchObject({
      tenant_id: TENANT, facility_id: FACILITY, source: 'library', status: 'open', next_due_at: '2030-01-01',
      system_key: `env:permit-renewal:${PERMIT_ID}:${FACILITY}`,
    })
  })

  it('puts nothing on the calendar for a draft permit', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: permitRow({ status: 'draft' }) }], compliance_calendar_obligations: [{ data: null }] })
    allow(adminGate, db.client)
    await POST(jsonRequest('/api/environmental/permits', 'POST', validBody({ status: 'draft' })))
    expect(db.used('compliance_calendar_obligations', 'insert')).toEqual([])
  })

  it('answers 409 for a duplicate permit number and 404 for a site that is not the tenant\'s', async () => {
    allow(adminGate, fakeSupabase({ environmental_permits: [{ error: { message: 'dup', code: '23505' } }] }).client)
    expect((await POST(jsonRequest('/api/environmental/permits', 'POST', validBody()))).status).toBe(409)
    allow(adminGate, fakeSupabase({ environmental_permits: [{ error: { message: 'fk', code: '23503' } }] }).client)
    expect((await POST(jsonRequest('/api/environmental/permits', 'POST', validBody({ facility_id: OTHER_FACILITY })))).status).toBe(404)
  })

  it('needs a site: with none active and none given, it says so', async () => {
    allow(adminGate, fakeSupabase().client, { facilityId: null })
    const res = await POST(jsonRequest('/api/environmental/permits', 'POST', validBody()))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/facility_id/)
  })
})

describe('PATCH /api/environmental/permits/[id]', () => {
  const patch = (body: unknown, id = PERMIT_ID) => PATCH(jsonRequest(`/api/environmental/permits/${id}`, 'PATCH', body), params({ id }))

  it('rejects a malformed id', async () => {
    allow(adminGate, fakeSupabase().client)
    expect((await patch({}, 'nope')).status).toBe(400)
  })

  it('answers 404 for a permit that is not there', async () => {
    allow(adminGate, fakeSupabase({ environmental_permits: [{ data: null }] }).client)
    expect((await patch({ notes: 'x' })).status).toBe(404)
  })

  it('changes only what was sent, keeps the permit on its own site even if told otherwise, and moves the renewal deadline', async () => {
    const updated = permitRow({ expiration_date: '2031-06-30', notes: 'renewed' })
    const db = fakeSupabase({
      environmental_permits: [{ data: permitRow() }, { data: updated }],
      compliance_calendar_obligations: [{ data: { id: 'ob-1', status: 'open', next_due_at: '2030-01-01', title: 'Renew CA IGP WDID-1' } }],
    })
    allow(adminGate, db.client)
    const res = await patch({ expiration_date: '2031-06-30', notes: 'renewed', facility_id: OTHER_FACILITY })
    expect(res.status).toBe(200)
    const sent = db.arg('environmental_permits', 'update') as Record<string, unknown>
    expect(sent).toMatchObject({ facility_id: FACILITY, permit_type: 'CA IGP', permit_number: 'WDID-1', expiration_date: '2031-06-30', notes: 'renewed', updated_by: USER })
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ next_due_at: '2031-01-01' })
  })

  it('refuses an edit that would make the dates impossible', async () => {
    allow(adminGate, fakeSupabase({ environmental_permits: [{ data: permitRow() }] }).client)
    expect((await patch({ expiration_date: '2020-01-01' })).status).toBe(400)
  })

  it('dismisses the renewal deadline when the permit stops being in force', async () => {
    const db = fakeSupabase({
      environmental_permits: [{ data: permitRow() }, { data: permitRow({ status: 'terminated' }) }],
      compliance_calendar_obligations: [{ data: { id: 'ob-1', status: 'open', next_due_at: '2030-01-01', title: 'Renew CA IGP WDID-1' } }],
    })
    allow(adminGate, db.client)
    await patch({ status: 'terminated' })
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ status: 'dismissed' })
  })
})

describe('DELETE /api/environmental/permits/[id]', () => {
  const remove = (id = PERMIT_ID) => DELETE(jsonRequest(`/api/environmental/permits/${id}`, 'DELETE'), params({ id }))

  it('answers 404 for a permit that is not there, and deletes nothing', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await remove()).status).toBe(404)
    expect(db.used('environmental_permits', 'delete')).toEqual([])
  })

  it('deletes the permit and dismisses its renewal deadline', async () => {
    const db = fakeSupabase({ environmental_permits: [{ data: { id: PERMIT_ID, facility_id: FACILITY } }, { data: null }] })
    allow(adminGate, db.client)
    expect((await remove()).status).toBe(200)
    expect(db.used('environmental_permits', 'delete')).toHaveLength(1)
    expect(db.arg('compliance_calendar_obligations', 'update')).toMatchObject({ status: 'dismissed' })
  })

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await remove()).status).toBe(403)
  })
})
