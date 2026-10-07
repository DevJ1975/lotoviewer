import { describe, it, expect, beforeEach } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params,
  TENANT, FACILITY, OTHER_FACILITY, USER, type Call, type Result,
} from './_harness'
import { GET, POST } from '@/app/api/environmental/outfalls/route'
import { PATCH, DELETE } from '@/app/api/environmental/outfalls/[id]/route'

const OUTFALL_ID = 'f0000000-0000-0000-0000-0000000000a1'
const PARTNER_ID = 'f0000000-0000-0000-0000-0000000000a2'
const PERMIT_ID = 'f0000000-0000-0000-0000-000000000001'

const outfallRow = (over: Record<string, unknown> = {}) => ({
  id: OUTFALL_ID, tenant_id: TENANT, facility_id: FACILITY, permit_id: null, code: 'OF-001', name: 'North dock',
  receiving_water: 'Santa Ana River', drainage_area: 'Yard', latitude: 34.1, longitude: -117.4, outfall_type: 'stormwater',
  substantially_identical_to: null, is_sampling_point: true, status: 'active', photo_path: null, notes: 'old', ...over,
})

const validBody = (over: Record<string, unknown> = {}) => ({ code: 'OF-001', ...over })

// ── scripting the fake database ─────────────────────────────────────────────
const hasOp = (call: Call, method: string) => call.ops.some(o => o.method === method)
const eqValue = (call: Call, column: string) => call.ops.find(o => o.method === 'eq' && o.args[0] === column)?.args[1]

/**
 * A row that lives at `site`. Row-level security lets the tenant read it from any
 * site, so a query misses it only if it filters on the site, which is exactly
 * what the cross-site checks must do.
 */
const rowAt = (site: string, row: object) => (call: Call): Result => {
  const filteredSite = eqValue(call, 'facility_id')
  return { data: filteredSite === undefined || filteredSite === site ? row : null }
}

/**
 * What the outfalls table answers: the stored outfall for a read by id, a
 * "substantially identical" partner for a lookup of PARTNER_ID, and `saved` for
 * an insert or update.
 */
const outfallsTable = (o: { stored?: Result; partner?: { site: string }; saved?: Result } = {}) => (call: Call): Result => {
  if (hasOp(call, 'insert') || hasOp(call, 'update')) return o.saved ?? { data: outfallRow() }
  if (eqValue(call, 'id') === PARTNER_ID) return o.partner ? rowAt(o.partner.site, { id: PARTNER_ID })(call) : { data: null }
  return o.stored ?? { data: outfallRow() }
}

const permitAt = (site: string) => rowAt(site, { id: PERMIT_ID })

const foreignKeyViolation = (constraint: string): Result => ({
  error: { code: '23503', message: `insert or update on table "stormwater_outfalls" violates foreign key constraint "${constraint}"` },
})

beforeEach(resetGates)

describe('GET /api/environmental/outfalls', () => {
  it('passes a gate refusal straight through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    const res = await GET(jsonRequest('/api/environmental/outfalls', 'GET'))
    expect(res.status).toBe(403)
  })

  it('lists the active site\'s outfalls, in code order, for a plain member', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: [outfallRow(), outfallRow({ id: 'o2', code: 'OF-002' })] }] })
    allow(memberGate, db.client, { role: 'member' })
    const res = await GET(jsonRequest('/api/environmental/outfalls', 'GET'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(db.filtered('stormwater_outfalls', 'facility_id', FACILITY)).toBe(true)
    expect(db.filtered('stormwater_outfalls', 'tenant_id', TENANT)).toBe(true)
    expect(db.arg('stormwater_outfalls', 'order')).toBe('code')
    expect(body.outfalls.map((o: { code: string }) => o.code)).toEqual(['OF-001', 'OF-002'])
  })

  it('answers an empty list, not null, when a site has no outfalls', async () => {
    allow(memberGate, fakeSupabase({ stormwater_outfalls: [{ data: null }] }).client)
    expect((await (await GET(jsonRequest('/api/environmental/outfalls', 'GET'))).json()).outfalls).toEqual([])
  })

  it('lets ?facility_id choose the site, and shows every site in roll-up mode', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: [] }] })
    allow(memberGate, db.client, { facilityId: null })
    await GET(jsonRequest(`/api/environmental/outfalls?facility_id=${OTHER_FACILITY}`, 'GET'))
    expect(db.filtered('stormwater_outfalls', 'facility_id', OTHER_FACILITY)).toBe(true)

    const rollup = fakeSupabase({ stormwater_outfalls: [{ data: [] }] })
    allow(memberGate, rollup.client, { facilityId: null })
    await GET(jsonRequest('/api/environmental/outfalls', 'GET'))
    expect(rollup.calls[0]!.ops.some(o => o.method === 'eq' && o.args[0] === 'facility_id')).toBe(false)
  })

  it('prefers ?facility_id over the active site', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(`/api/environmental/outfalls?facility_id=${OTHER_FACILITY}`, 'GET'))
    expect(db.filtered('stormwater_outfalls', 'facility_id', OTHER_FACILITY)).toBe(true)
    expect(db.filtered('stormwater_outfalls', 'facility_id', FACILITY)).toBe(false)
  })

  it('rejects a malformed facility id before any query', async () => {
    const db = fakeSupabase()
    allow(memberGate, db.client)
    expect((await GET(jsonRequest('/api/environmental/outfalls?facility_id=nope', 'GET'))).status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('answers 500 without leaking the database error', async () => {
    allow(memberGate, fakeSupabase({ stormwater_outfalls: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await GET(jsonRequest('/api/environmental/outfalls', 'GET'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/outfalls', () => {
  it('is for tenant admins: a refusal from the admin gate stops it before any query', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody()))).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects malformed JSON and an invalid outfall, listing every problem', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    const bad = await POST(new Request('https://example.com/x', { method: 'POST', body: '{' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_json')

    const res = await POST(jsonRequest('/api/environmental/outfalls', 'POST', { code: 'has space', outfall_type: 'pipe', latitude: 91, longitude: 0 }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid')
    expect(body.details.length).toBeGreaterThan(2)
    expect(db.calls).toEqual([])
  })

  it('refuses a photo path in another tenant\'s folder', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    const res = await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody({ photo_path: '22222222-2222-2222-2222-222222222222/x.jpg' })))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('creates the outfall on the active site and stamps who made it', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: outfallRow() }] })
    allow(adminGate, db.client)
    const res = await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody({ photo_path: `${TENANT}/outfalls/of-1.jpg` })))
    expect(res.status).toBe(201)
    expect((await res.json()).outfall.id).toBe(OUTFALL_ID)
    expect(db.arg('stormwater_outfalls', 'insert')).toMatchObject({
      tenant_id: TENANT, facility_id: FACILITY, created_by: USER, updated_by: USER, code: 'OF-001',
      outfall_type: 'stormwater', status: 'active', is_sampling_point: false, permit_id: null, photo_path: `${TENANT}/outfalls/of-1.jpg`,
    })
  })

  it('needs no lookup when it references nothing', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: outfallRow() }] })
    allow(adminGate, db.client)
    await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody()))
    expect(db.calls.map(c => c.table)).toEqual(['stormwater_outfalls'])
  })

  it('needs a site: with none active and none given, it says so', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client, { facilityId: null })
    const res = await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody()))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/facility_id/)
    expect(db.calls).toEqual([])
  })

  it('answers 409 for a code the site already has', async () => {
    allow(adminGate, fakeSupabase({ stormwater_outfalls: [{ error: { message: 'dup', code: '23505' } }] }).client)
    const res = await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('duplicate_outfall_code')
  })

  describe('references to a permit or another outfall', () => {
    const post = (body: Record<string, unknown>) => POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody(body)))

    it('accepts a permit and a partner outfall that belong to the same site', async () => {
      const db = fakeSupabase({ environmental_permits: permitAt(FACILITY), stormwater_outfalls: outfallsTable({ partner: { site: FACILITY } }) })
      allow(adminGate, db.client)
      const res = await post({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID })
      expect(res.status).toBe(201)
      expect(db.arg('stormwater_outfalls', 'insert')).toMatchObject({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID })
    })

    it('looks the references up on the outfall\'s own site, inside the tenant', async () => {
      const db = fakeSupabase({ environmental_permits: permitAt(FACILITY), stormwater_outfalls: outfallsTable({ partner: { site: FACILITY } }) })
      allow(adminGate, db.client)
      await post({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID })
      for (const table of ['environmental_permits', 'stormwater_outfalls']) {
        expect(db.filtered(table, 'tenant_id', TENANT), table).toBe(true)
        expect(db.filtered(table, 'facility_id', FACILITY), table).toBe(true)
      }
    })

    it('refuses a permit that belongs to another site, and inserts nothing', async () => {
      const db = fakeSupabase({ environmental_permits: permitAt(OTHER_FACILITY), stormwater_outfalls: outfallsTable() })
      allow(adminGate, db.client)
      const res = await post({ permit_id: PERMIT_ID })
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body).toEqual({ error: 'invalid', details: [expect.stringMatching(/permit_id must be a permit at this site/)] })
      expect(db.used('stormwater_outfalls', 'insert')).toEqual([])
    })

    it('refuses a partner outfall that belongs to another site, and inserts nothing', async () => {
      const db = fakeSupabase({ stormwater_outfalls: outfallsTable({ partner: { site: OTHER_FACILITY } }) })
      allow(adminGate, db.client)
      const res = await post({ substantially_identical_to: PARTNER_ID })
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body).toEqual({ error: 'invalid', details: [expect.stringMatching(/substantially_identical_to must be another outfall at this site/)] })
      expect(db.used('stormwater_outfalls', 'insert')).toEqual([])
    })

    it('refuses a reference to a row that does not exist at all', async () => {
      allow(adminGate, fakeSupabase({ environmental_permits: [{ data: null }] }).client)
      expect((await post({ permit_id: PERMIT_ID })).status).toBe(400)
    })

    it('reports both references when both are wrong', async () => {
      allow(adminGate, fakeSupabase({ environmental_permits: permitAt(OTHER_FACILITY), stormwater_outfalls: outfallsTable({ partner: { site: OTHER_FACILITY } }) }).client)
      const body = await (await post({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID })).json()
      expect(body.details).toHaveLength(2)
    })

    it('answers 500, and inserts nothing, when a reference cannot be looked up', async () => {
      const db = fakeSupabase({ environmental_permits: [{ error: { message: 'relation exploded' } }], stormwater_outfalls: outfallsTable() })
      allow(adminGate, db.client)
      const res = await post({ permit_id: PERMIT_ID })
      expect(res.status).toBe(500)
      expect(JSON.stringify(await res.json())).not.toContain('exploded')
      expect(db.used('stormwater_outfalls', 'insert')).toEqual([])
    })
  })

  describe('a foreign-key failure on insert', () => {
    const post = (body: Record<string, unknown>) => POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody(body)))

    it('is a 404 when the database names the site', async () => {
      allow(adminGate, fakeSupabase({ stormwater_outfalls: [foreignKeyViolation('stormwater_outfalls_tenant_id_facility_id_fkey')] }).client)
      const res = await post({ facility_id: OTHER_FACILITY })
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('facility_not_found')
    })

    it('is a 400 that names the permit when the database names the permit', async () => {
      allow(adminGate, fakeSupabase({
        environmental_permits: permitAt(FACILITY),
        stormwater_outfalls: [foreignKeyViolation('stormwater_outfalls_permit_id_fkey')],
      }).client)
      const res = await post({ permit_id: PERMIT_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: [expect.stringMatching(/permit_id/)] })
    })

    it('is a 400 that names the partner outfall when the database names that', async () => {
      allow(adminGate, fakeSupabase({
        stormwater_outfalls: outfallsTable({ partner: { site: FACILITY }, saved: foreignKeyViolation('stormwater_outfalls_substantially_identical_to_fkey') }),
      }).client)
      const res = await post({ substantially_identical_to: PARTNER_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: [expect.stringMatching(/substantially_identical_to/)] })
    })

    it('is a 400 invalid_reference naming every candidate when the database names none', async () => {
      allow(adminGate, fakeSupabase({ stormwater_outfalls: [{ error: { message: 'fk', code: '23503' } }] }).client)
      const res = await post({})
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.error).toBe('invalid_reference')
      expect(body.details[0]).toMatch(/facility_id.*permit_id.*substantially_identical_to/)
    })
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ stormwater_outfalls: [{ error: { message: 'relation exploded', code: 'XX000' } }] }).client)
    const res = await POST(jsonRequest('/api/environmental/outfalls', 'POST', validBody()))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('PATCH /api/environmental/outfalls/[id]', () => {
  const patch = (body: unknown, id = OUTFALL_ID) => PATCH(jsonRequest(`/api/environmental/outfalls/${id}`, 'PATCH', body), params({ id }))

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await patch({})).status).toBe(403)
  })

  it('rejects a malformed id before any query', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await patch({}, 'nope')).status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('rejects malformed JSON', async () => {
    allow(adminGate, fakeSupabase().client)
    const res = await PATCH(new Request('https://example.com/x', { method: 'PATCH', body: '{' }), params({ id: OUTFALL_ID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('answers 404 for an outfall that is not there, and updates nothing', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await patch({ notes: 'x' })).status).toBe(404)
    expect(db.used('stormwater_outfalls', 'update')).toEqual([])
  })

  it('changes only what was sent, and keeps the outfall on its own site even if told otherwise', async () => {
    const db = fakeSupabase({ stormwater_outfalls: outfallsTable({ saved: { data: outfallRow({ notes: 'repainted' }) } }) })
    allow(adminGate, db.client)
    const res = await patch({ notes: 'repainted', facility_id: OTHER_FACILITY })
    expect(res.status).toBe(200)
    expect((await res.json()).outfall.notes).toBe('repainted')
    const sent = db.arg('stormwater_outfalls', 'update') as Record<string, unknown>
    expect(sent).toMatchObject({
      facility_id: FACILITY, code: 'OF-001', name: 'North dock', receiving_water: 'Santa Ana River', drainage_area: 'Yard',
      latitude: 34.1, longitude: -117.4, is_sampling_point: true, notes: 'repainted', updated_by: USER,
    })
    expect(sent).not.toHaveProperty('tenant_id')
    expect(sent).not.toHaveProperty('created_by')
  })

  it('scopes the read and the write to the tenant and the outfall', async () => {
    const db = fakeSupabase({ stormwater_outfalls: outfallsTable() })
    allow(adminGate, db.client)
    await patch({ notes: 'x' })
    expect(db.calls).toHaveLength(2)
    for (const call of db.calls) {
      expect(eqValue(call, 'tenant_id')).toBe(TENANT)
      expect(eqValue(call, 'id')).toBe(OUTFALL_ID)
    }
  })

  it('clears a field only when it is sent as null', async () => {
    const db = fakeSupabase({ stormwater_outfalls: outfallsTable() })
    allow(adminGate, db.client)
    await patch({ name: null })
    expect(db.arg('stormwater_outfalls', 'update')).toMatchObject({ name: null, receiving_water: 'Santa Ana River' })
  })

  it('refuses an edit that makes the outfall invalid, and updates nothing', async () => {
    const db = fakeSupabase({ stormwater_outfalls: outfallsTable() })
    allow(adminGate, db.client)
    const res = await patch({ status: 'gone', latitude: null })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.details).toHaveLength(2)
    expect(db.used('stormwater_outfalls', 'update')).toEqual([])
  })

  it('refuses a photo path in another tenant\'s folder', async () => {
    const db = fakeSupabase({ stormwater_outfalls: outfallsTable() })
    allow(adminGate, db.client)
    expect((await patch({ photo_path: '22222222-2222-2222-2222-222222222222/x.jpg' })).status).toBe(400)
    expect(db.used('stormwater_outfalls', 'update')).toEqual([])
  })

  it('answers 409 when a rename collides with another outfall\'s code', async () => {
    allow(adminGate, fakeSupabase({ stormwater_outfalls: outfallsTable({ saved: { error: { message: 'dup', code: '23505' } } }) }).client)
    const res = await patch({ code: 'OF-002' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('duplicate_outfall_code')
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ stormwater_outfalls: outfallsTable({ saved: { error: { message: 'relation exploded', code: 'XX000' } } }) }).client)
    const res = await patch({ notes: 'x' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })

  describe('references to a permit or another outfall', () => {
    it('accepts a permit and a partner outfall that belong to the outfall\'s site', async () => {
      const db = fakeSupabase({ environmental_permits: permitAt(FACILITY), stormwater_outfalls: outfallsTable({ partner: { site: FACILITY } }) })
      allow(adminGate, db.client)
      expect((await patch({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID })).status).toBe(200)
      expect(db.arg('stormwater_outfalls', 'update')).toMatchObject({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID })
    })

    it('refuses a permit that belongs to another site, and updates nothing', async () => {
      const db = fakeSupabase({ environmental_permits: permitAt(OTHER_FACILITY), stormwater_outfalls: outfallsTable() })
      allow(adminGate, db.client)
      const res = await patch({ permit_id: PERMIT_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: [expect.stringMatching(/permit_id must be a permit at this site/)] })
      expect(db.used('stormwater_outfalls', 'update')).toEqual([])
    })

    it('refuses a partner outfall that belongs to another site, and updates nothing', async () => {
      const db = fakeSupabase({ stormwater_outfalls: outfallsTable({ partner: { site: OTHER_FACILITY } }) })
      allow(adminGate, db.client)
      const res = await patch({ substantially_identical_to: PARTNER_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: [expect.stringMatching(/substantially_identical_to must be another outfall at this site/)] })
      expect(db.used('stormwater_outfalls', 'update')).toEqual([])
    })

    it('judges the references against the outfall\'s own site, not the one named in the body', async () => {
      const db = fakeSupabase({ environmental_permits: permitAt(OTHER_FACILITY), stormwater_outfalls: outfallsTable() })
      allow(adminGate, db.client)
      expect((await patch({ permit_id: PERMIT_ID, facility_id: OTHER_FACILITY })).status).toBe(400)
      expect(db.filtered('environmental_permits', 'facility_id', FACILITY)).toBe(true)
    })

    it('refuses an outfall that names itself as its own partner', async () => {
      const db = fakeSupabase({ stormwater_outfalls: outfallsTable() })
      allow(adminGate, db.client)
      const res = await patch({ substantially_identical_to: OUTFALL_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: [expect.stringMatching(/cannot be the outfall itself/)] })
      expect(db.used('stormwater_outfalls', 'update')).toEqual([])
    })

    it('needs no lookup to remove a reference', async () => {
      const db = fakeSupabase({
        stormwater_outfalls: outfallsTable({ stored: { data: outfallRow({ permit_id: PERMIT_ID, substantially_identical_to: PARTNER_ID }) } }),
      })
      allow(adminGate, db.client)
      expect((await patch({ permit_id: null, substantially_identical_to: null })).status).toBe(200)
      expect(db.arg('stormwater_outfalls', 'update')).toMatchObject({ permit_id: null, substantially_identical_to: null })
      expect(db.used('environmental_permits', 'select')).toEqual([])
    })
  })
})

describe('DELETE /api/environmental/outfalls/[id]', () => {
  const remove = (id = OUTFALL_ID) => DELETE(jsonRequest(`/api/environmental/outfalls/${id}`, 'DELETE'), params({ id }))

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await remove()).status).toBe(403)
  })

  it('rejects a malformed id before any query', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await remove('nope')).status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('answers 404 for an outfall that is not there, and deletes nothing', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await remove()).status).toBe(404)
    expect(db.used('stormwater_outfalls', 'delete')).toEqual([])
  })

  it('deletes the outfall within the tenant', async () => {
    const db = fakeSupabase({ stormwater_outfalls: [{ data: { id: OUTFALL_ID } }, { data: null }] })
    allow(adminGate, db.client)
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const [deletion] = db.used('stormwater_outfalls', 'delete')
    expect(deletion).toBeDefined()
    expect(eqValue(deletion!, 'tenant_id')).toBe(TENANT)
    expect(eqValue(deletion!, 'id')).toBe(OUTFALL_ID)
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ stormwater_outfalls: [{ data: { id: OUTFALL_ID } }, { error: { message: 'relation exploded' } }] }).client)
    const res = await remove()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})
