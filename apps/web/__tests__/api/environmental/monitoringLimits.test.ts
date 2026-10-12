import { describe, it, expect, beforeEach } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params,
  TENANT, FACILITY, OTHER_FACILITY, USER, type Call, type Result,
} from './_harness'
import { GET, POST } from '@/app/api/environmental/monitoring/limits/route'
import { PATCH, DELETE } from '@/app/api/environmental/monitoring/limits/[id]/route'
import { POST as ADOPT } from '@/app/api/environmental/monitoring/limits/adopt-defaults/route'
import { DEFAULT_LIMITS } from '@soteria/core/environmental/monitoringDefaults'

const LIMIT_ID = 'f0000000-0000-0000-0000-0000000000b1'
const OUTFALL_ID = 'f0000000-0000-0000-0000-0000000000a1'
const PERMIT_ID = 'f0000000-0000-0000-0000-000000000001'
const URL = '/api/environmental/monitoring/limits'

const limitRow = (over: Record<string, unknown> = {}) => ({
  id: LIMIT_ID, tenant_id: TENANT, facility_id: FACILITY, outfall_id: null, permit_id: null, parameter: 'TSS', unit: 'mg/L',
  limit_kind: 'instantaneous_max', value: 100, basis: 'benchmark', citation: 'old citation', verify: null, source: 'tenant', library_key: null,
  effective_from: null, effective_to: null, ...over,
})

const validBody = (over: Record<string, unknown> = {}) => ({ parameter: 'TSS', unit: 'mg/L', value: 100, basis: 'benchmark', ...over })

// ── scripting the fake database ─────────────────────────────────────────────
const hasOp = (call: Call, method: string) => call.ops.some(o => o.method === method)
const eqValue = (call: Call, column: string) => call.ops.find(o => o.method === 'eq' && o.args[0] === column)?.args[1]

/** A row that lives at `site`: found only by a query that filters on that site. */
const rowAt = (site: string, row: object) => (call: Call): Result => {
  const filtered = eqValue(call, 'facility_id')
  return { data: filtered === undefined || filtered === site ? row : null }
}

/** The limits table: the stored limit for a read, `saved` for an insert or an update. */
const limitsTable = (o: { stored?: Result; saved?: Result } = {}) => (call: Call): Result => {
  if (hasOp(call, 'insert') || hasOp(call, 'update')) return o.saved ?? { data: limitRow() }
  return o.stored ?? { data: limitRow() }
}

const constraintFailure = (code: string, message: string): Result => ({ error: { code, message } })

beforeEach(resetGates)

describe('GET /api/environmental/monitoring/limits', () => {
  it('passes a gate refusal straight through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await GET(jsonRequest(URL, 'GET'))).status).toBe(403)
  })

  it('lists the active site\'s limits, in parameter order, for a plain member', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: [limitRow(), limitRow({ id: 'l2', parameter: 'pH' })] }] })
    allow(memberGate, db.client, { role: 'member' })
    const res = await GET(jsonRequest(URL, 'GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).limits.map((l: { parameter: string }) => l.parameter)).toEqual(['TSS', 'pH'])
    expect(db.filtered('monitoring_limits', 'tenant_id', TENANT)).toBe(true)
    expect(db.filtered('monitoring_limits', 'facility_id', FACILITY)).toBe(true)
    expect(db.arg('monitoring_limits', 'order')).toBe('parameter')
  })

  it('never reads an unbounded list', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(URL, 'GET'))
    expect(db.arg('monitoring_limits', 'limit')).toBe(500)
  })

  it('answers an empty list, not null, for a site with no limits', async () => {
    allow(memberGate, fakeSupabase({ monitoring_limits: [{ data: null }] }).client)
    expect((await (await GET(jsonRequest(URL, 'GET'))).json()).limits).toEqual([])
  })

  it('narrows to an outfall when asked', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(`${URL}?outfall_id=${OUTFALL_ID}`, 'GET'))
    expect(db.filtered('monitoring_limits', 'outfall_id', OUTFALL_ID)).toBe(true)
  })

  it('prefers ?facility_id over the active site, and shows every site in roll-up mode', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(`${URL}?facility_id=${OTHER_FACILITY}`, 'GET'))
    expect(db.filtered('monitoring_limits', 'facility_id', OTHER_FACILITY)).toBe(true)
    expect(db.filtered('monitoring_limits', 'facility_id', FACILITY)).toBe(false)

    const rollup = fakeSupabase({ monitoring_limits: [{ data: [] }] })
    allow(memberGate, rollup.client, { facilityId: null })
    await GET(jsonRequest(URL, 'GET'))
    expect(rollup.calls[0]!.ops.some(o => o.method === 'eq' && o.args[0] === 'facility_id')).toBe(false)
    expect(rollup.filtered('monitoring_limits', 'tenant_id', TENANT)).toBe(true)
  })

  it('rejects a malformed id before any query', async () => {
    const db = fakeSupabase()
    allow(memberGate, db.client)
    expect((await GET(jsonRequest(`${URL}?outfall_id=nope`, 'GET'))).status).toBe(400)
    expect((await GET(jsonRequest(`${URL}?facility_id=nope`, 'GET'))).status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('answers 500 without leaking the database error', async () => {
    allow(memberGate, fakeSupabase({ monitoring_limits: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await GET(jsonRequest(URL, 'GET'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/monitoring/limits', () => {
  const post = (body: Record<string, unknown> = {}) => POST(jsonRequest(URL, 'POST', validBody(body)))

  it('is for tenant admins: a refusal from the admin gate stops it before any query', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await post()).status).toBe(403)
    expect(db.calls).toEqual([])
    expect(memberGate).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON, and an invalid limit with every problem listed, before any query', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    const bad = await POST(new Request('https://example.com/x', { method: 'POST', body: '{' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('invalid_json')

    const res = await POST(jsonRequest(URL, 'POST', { parameter: '', unit: '', value: -1, basis: 'guideline' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('invalid')
    expect(body.details).toHaveLength(4)
    expect(db.calls).toEqual([])
  })

  it('creates the limit on the active site and stamps who made it', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: limitRow() }] })
    allow(adminGate, db.client)
    const res = await post({ citation: 'Permit table 2', effective_from: '2026-07-01' })
    expect(res.status).toBe(201)
    expect((await res.json()).limit.id).toBe(LIMIT_ID)
    expect(db.arg('monitoring_limits', 'insert')).toEqual({
      tenant_id: TENANT, created_by: USER, facility_id: FACILITY, outfall_id: null, permit_id: null, parameter: 'TSS', unit: 'mg/L',
      limit_kind: 'instantaneous_max', value: 100, basis: 'benchmark', citation: 'Permit table 2', verify: null,
      effective_from: '2026-07-01', effective_to: null,
    })
  })

  it('keeps the distinction between a permit limit and a benchmark as the caller gave it', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: limitRow() }] })
    allow(adminGate, db.client)
    await post({ basis: 'numeric_action_level' })
    expect(db.arg('monitoring_limits', 'insert')).toMatchObject({ basis: 'numeric_action_level' })
  })

  it('does not let a request claim a library source, a library key, or another tenant', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: limitRow() }] })
    allow(adminGate, db.client)
    await post({ source: 'library', library_key: 'ca-igp-nal-tss-annual', tenant_id: '22222222-2222-2222-2222-222222222222', created_by: 'someone' })
    const inserted = db.arg('monitoring_limits', 'insert') as Record<string, unknown>
    expect(inserted).not.toHaveProperty('source')
    expect(inserted).not.toHaveProperty('library_key')
    expect(inserted).toMatchObject({ tenant_id: TENANT, created_by: USER })
  })

  it('needs no lookup when it references nothing', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: limitRow() }] })
    allow(adminGate, db.client)
    await post()
    expect(db.calls.map(c => c.table)).toEqual(['monitoring_limits'])
  })

  it('needs a site: with none active and none given, it says so', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client, { facilityId: null })
    const res = await post()
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/facility_id/)
    expect(db.calls).toEqual([])
  })

  describe('references to an outfall or a permit', () => {
    it('accepts an outfall and a permit at the same site, looking each up on that site inside the tenant', async () => {
      const db = fakeSupabase({
        stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), environmental_permits: rowAt(FACILITY, { id: PERMIT_ID }),
        monitoring_limits: [{ data: limitRow() }],
      })
      allow(adminGate, db.client)
      const res = await post({ outfall_id: OUTFALL_ID, permit_id: PERMIT_ID })
      expect(res.status).toBe(201)
      expect(db.arg('monitoring_limits', 'insert')).toMatchObject({ outfall_id: OUTFALL_ID, permit_id: PERMIT_ID })
      for (const table of ['stormwater_outfalls', 'environmental_permits']) {
        expect(db.filtered(table, 'tenant_id', TENANT), table).toBe(true)
        expect(db.filtered(table, 'facility_id', FACILITY), table).toBe(true)
      }
    })

    it('refuses an outfall that belongs to another site, and inserts nothing', async () => {
      const db = fakeSupabase({ stormwater_outfalls: rowAt(OTHER_FACILITY, { id: OUTFALL_ID }) })
      allow(adminGate, db.client)
      const res = await post({ outfall_id: OUTFALL_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: ['outfall_id must be an outfall at this site.'] })
      expect(db.used('monitoring_limits', 'insert')).toEqual([])
    })

    it('refuses a permit that belongs to another site, and inserts nothing', async () => {
      const db = fakeSupabase({ environmental_permits: rowAt(OTHER_FACILITY, { id: PERMIT_ID }) })
      allow(adminGate, db.client)
      const res = await post({ permit_id: PERMIT_ID })
      expect(await res.json()).toEqual({ error: 'invalid', details: ['permit_id must be a permit at this site.'] })
      expect(db.used('monitoring_limits', 'insert')).toEqual([])
    })

    it('reports both when both are wrong', async () => {
      allow(adminGate, fakeSupabase({ stormwater_outfalls: [{ data: null }], environmental_permits: [{ data: null }] }).client)
      expect((await (await post({ outfall_id: OUTFALL_ID, permit_id: PERMIT_ID })).json()).details).toHaveLength(2)
    })

    it('answers 500, and inserts nothing, when a reference cannot be looked up', async () => {
      const db = fakeSupabase({ stormwater_outfalls: [{ error: { message: 'relation exploded' } }] })
      allow(adminGate, db.client)
      const res = await post({ outfall_id: OUTFALL_ID })
      expect(res.status).toBe(500)
      expect(JSON.stringify(await res.json())).not.toContain('exploded')
      expect(db.used('monitoring_limits', 'insert')).toEqual([])
    })
  })

  describe('when the database refuses', () => {
    const refusedWith = async (code: string, message: string) => {
      allow(adminGate, fakeSupabase({ monitoring_limits: [constraintFailure(code, message)] }).client)
      const res = await post()
      return { status: res.status, body: await res.json() }
    }

    it('answers 400 with a field message when the outfall, permit or site is not allowed (23503)', async () => {
      expect(await refusedWith('23503', 'violates foreign key constraint "monitoring_limits_outfall_fk"')).toEqual({
        status: 400, body: { error: 'invalid', details: ['outfall_id must be an outfall at this site.'] },
      })
      expect(await refusedWith('23503', 'violates foreign key constraint "monitoring_limits_permit_fk"')).toMatchObject({ status: 400 })
      expect(await refusedWith('23503', 'violates foreign key constraint "monitoring_limits_tenant_id_facility_id_fkey"')).toEqual({
        status: 400, body: { error: 'invalid', details: ['facility_id must be a site in this account.'] },
      })
    })

    it('answers 400 for a rule the table holds (23514), 409 for a duplicate (23505) and 403 for a refusal by policy (42501)', async () => {
      expect(await refusedWith('23514', 'violates check constraint "monitoring_limits_dates_ordered"')).toMatchObject({ status: 400 })
      expect(await refusedWith('23505', 'violates unique constraint "x"')).toMatchObject({ status: 409 })
      expect(await refusedWith('42501', 'new row violates row-level security policy')).toMatchObject({ status: 403 })
    })

    it('answers 500 for anything else, without leaking it', async () => {
      const { status, body } = await refusedWith('XX000', 'relation exploded')
      expect(status).toBe(500)
      expect(JSON.stringify(body)).not.toContain('exploded')
    })

    it('never puts the database\'s words in any answer', async () => {
      for (const [code, message] of [['23503', 'monitoring_limits_x'], ['23514', 'monitoring_limits_x'], ['23505', 'monitoring_limits_x'], ['42501', 'monitoring_limits_x']]) {
        expect(JSON.stringify((await refusedWith(code!, message!)).body), code).not.toContain('monitoring_limits_x')
      }
    })
  })
})

describe('PATCH /api/environmental/monitoring/limits/[id]', () => {
  const patch = (body: unknown, id = LIMIT_ID) => PATCH(jsonRequest(`${URL}/${id}`, 'PATCH', body), params({ id }))

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await patch({})).status).toBe(403)
    expect(memberGate).not.toHaveBeenCalled()
  })

  it('rejects a malformed id before any query, and malformed JSON', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await patch({}, 'nope')).status).toBe(400)
    expect(db.calls).toEqual([])
    const res = await PATCH(new Request('https://example.com/x', { method: 'PATCH', body: '{' }), params({ id: LIMIT_ID }))
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('answers 404 for a limit that is not there, and updates nothing', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await patch({ value: 1 })).status).toBe(404)
    expect(db.used('monitoring_limits', 'update')).toEqual([])
  })

  it('changes only what was sent, and keeps the limit on its own site even if told otherwise', async () => {
    const db = fakeSupabase({ monitoring_limits: limitsTable({ saved: { data: limitRow({ value: 120 }) } }) })
    allow(adminGate, db.client)
    const res = await patch({ value: 120, facility_id: OTHER_FACILITY })
    expect(res.status).toBe(200)
    expect((await res.json()).limit.value).toBe(120)
    const sent = db.arg('monitoring_limits', 'update') as Record<string, unknown>
    expect(sent).toEqual({
      facility_id: FACILITY, outfall_id: null, permit_id: null, parameter: 'TSS', unit: 'mg/L', limit_kind: 'instantaneous_max', value: 120,
      basis: 'benchmark', citation: 'old citation', verify: null, effective_from: null, effective_to: null,
    })
    expect(sent).not.toHaveProperty('tenant_id')
    expect(sent).not.toHaveProperty('source')
    expect(sent).not.toHaveProperty('library_key')
  })

  it('leaves a library limit a library limit: source and key are not in what an edit writes', async () => {
    const stored = limitRow({ source: 'library', library_key: 'ca-igp-nal-tss-annual', verify: 'Confirm it' })
    const db = fakeSupabase({ monitoring_limits: limitsTable({ stored: { data: stored } }) })
    allow(adminGate, db.client)
    await patch({ value: 90, source: 'tenant', library_key: null })
    const sent = db.arg('monitoring_limits', 'update') as Record<string, unknown>
    expect(sent).toMatchObject({ value: 90, verify: 'Confirm it' })
    expect(sent).not.toHaveProperty('source')
    expect(sent).not.toHaveProperty('library_key')
  })

  it('clears a field only when it is sent as null', async () => {
    const db = fakeSupabase({ monitoring_limits: limitsTable() })
    allow(adminGate, db.client)
    await patch({ citation: null })
    expect(db.arg('monitoring_limits', 'update')).toMatchObject({ citation: null, parameter: 'TSS' })
  })

  it('scopes the read and the write to the tenant and the limit', async () => {
    const db = fakeSupabase({ monitoring_limits: limitsTable() })
    allow(adminGate, db.client)
    await patch({ value: 1 })
    expect(db.calls).toHaveLength(2)
    for (const call of db.calls) {
      expect(eqValue(call, 'tenant_id')).toBe(TENANT)
      expect(eqValue(call, 'id')).toBe(LIMIT_ID)
    }
  })

  it('refuses an edit that makes the limit invalid, and updates nothing', async () => {
    const db = fakeSupabase({ monitoring_limits: limitsTable() })
    allow(adminGate, db.client)
    const res = await patch({ value: -5, basis: 'nope', effective_from: '2026-07-01', effective_to: '2026-06-01' })
    expect(res.status).toBe(400)
    expect((await res.json()).details.length).toBeGreaterThanOrEqual(3)
    expect(db.used('monitoring_limits', 'update')).toEqual([])
  })

  it('judges an outfall or permit against the limit\'s own site, not the one named in the body', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(OTHER_FACILITY, { id: OUTFALL_ID }), monitoring_limits: limitsTable() })
    allow(adminGate, db.client)
    const res = await patch({ outfall_id: OUTFALL_ID, facility_id: OTHER_FACILITY })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', details: ['outfall_id must be an outfall at this site.'] })
    expect(db.filtered('stormwater_outfalls', 'facility_id', FACILITY)).toBe(true)
    expect(db.used('monitoring_limits', 'update')).toEqual([])
  })

  it('answers 409 when a move collides with an adopted default, and 500 without leaking for anything else', async () => {
    allow(adminGate, fakeSupabase({ monitoring_limits: limitsTable({ saved: constraintFailure('23505', 'violates unique constraint "uq_monitoring_limits_library"') }) }).client)
    const conflict = await patch({ value: 1 })
    expect(conflict.status).toBe(409)
    expect((await conflict.json()).error).toBe('duplicate_library_limit')

    allow(adminGate, fakeSupabase({ monitoring_limits: limitsTable({ saved: constraintFailure('XX000', 'relation exploded') }) }).client)
    const res = await patch({ value: 1 })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('DELETE /api/environmental/monitoring/limits/[id]', () => {
  const remove = (id = LIMIT_ID) => DELETE(jsonRequest(`${URL}/${id}`, 'DELETE'), params({ id }))

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

  it('answers 404 for a limit that is not there, and deletes nothing', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await remove()).status).toBe(404)
    expect(db.used('monitoring_limits', 'delete')).toEqual([])
  })

  it('deletes the limit within the tenant', async () => {
    const db = fakeSupabase({ monitoring_limits: [{ data: { id: LIMIT_ID } }, { data: null }] })
    allow(adminGate, db.client)
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const [deletion] = db.used('monitoring_limits', 'delete')
    expect(eqValue(deletion!, 'tenant_id')).toBe(TENANT)
    expect(eqValue(deletion!, 'id')).toBe(LIMIT_ID)
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ monitoring_limits: [{ data: { id: LIMIT_ID } }, { error: { message: 'relation exploded' } }] }).client)
    const res = await remove()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/monitoring/limits/adopt-defaults', () => {
  const caKeys = DEFAULT_LIMITS.filter(d => d.generalPermit === 'ca_igp').map(d => d.libraryKey)
  const ca = { facilities: [{ data: { id: FACILITY, name: 'Plant 1', state: 'CA', settings: null } }], environmental_site_profiles: [{ data: { facility_id: FACILITY, stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp' } }] }
  const adopt = (body: unknown) => ADOPT(jsonRequest(`${URL}/adopt-defaults`, 'POST', body))

  /** The limits table when `existing` keys are already adopted. */
  const adoptedAlready = (existing: string[] = []) => (call: Call): Result => {
    const insert = call.ops.find(o => o.method === 'insert')?.args[0] as { library_key: string } | undefined
    return insert ? { data: { id: `id-${insert.library_key}`, ...insert } } : { data: existing.map(library_key => ({ library_key })) }
  }

  it('is admin-only', async () => {
    const db = fakeSupabase()
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await adopt({ keys: [caKeys[0]] })).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('rejects malformed JSON, and a body that names nothing, before any query', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await ADOPT(new Request('https://example.com/x', { method: 'POST', body: '{' }))).status).toBe(400)
    const res = await adopt({ keys: [] })
    expect(res.status).toBe(400)
    expect((await res.json()).details[0]).toMatch(/keys must list/)
    expect(db.calls).toEqual([])
  })

  it('needs a site', async () => {
    allow(adminGate, fakeSupabase().client, { facilityId: null })
    const res = await adopt({ keys: [caKeys[0]] })
    expect(res.status).toBe(400)
    expect((await res.json()).details).toEqual(['facility_id is required: choose a site first.'])
  })

  it('answers 404 for a site that is not there', async () => {
    allow(adminGate, fakeSupabase({ facilities: [{ data: null }] }).client)
    expect((await adopt({ keys: [caKeys[0]] })).status).toBe(404)
  })

  it('adopts the rows named as library limits, with their verify notes, and reports what was created', async () => {
    const db = fakeSupabase({ ...ca, monitoring_limits: adoptedAlready() })
    allow(adminGate, db.client)
    const res = await adopt({ keys: [caKeys[0], caKeys[1]] })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ created: 2, already_there: 0 })
    const inserts = db.used('monitoring_limits', 'insert').map(c => c.ops.find(o => o.method === 'insert')!.args[0] as Record<string, unknown>)
    expect(inserts.map(i => i.library_key)).toEqual([caKeys[0], caKeys[1]])
    for (const row of inserts) {
      expect(row).toMatchObject({ tenant_id: TENANT, facility_id: FACILITY, outfall_id: null, created_by: USER, source: 'library' })
      expect(String(row.verify).length).toBeGreaterThan(0)
      expect(String(row.citation).length).toBeGreaterThan(0)
    }
  })

  it('is idempotent: adopting what is already there adds nothing and says so', async () => {
    const db = fakeSupabase({ ...ca, monitoring_limits: adoptedAlready([caKeys[0]!, caKeys[1]!]) })
    allow(adminGate, db.client)
    const res = await adopt({ keys: [caKeys[0], caKeys[1]] })
    expect(await res.json()).toMatchObject({ created: 0, already_there: 2, limits: [] })
    expect(db.used('monitoring_limits', 'insert')).toEqual([])
  })

  it('refuses a key the site\'s profile does not offer, even a real default for another permit, and adopts nothing', async () => {
    const db = fakeSupabase({ ...ca, monitoring_limits: adoptedAlready() })
    allow(adminGate, db.client)
    const res = await adopt({ keys: [caKeys[0], 'epa-msgp-benchmark-tss-annual', 'made-up'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', details: ['Not a default available for this site: epa-msgp-benchmark-tss-annual, made-up.'] })
    expect(db.used('monitoring_limits', 'insert')).toEqual([])
  })

  it('offers nothing to a site whose profile names no general permit', async () => {
    const db = fakeSupabase({ ...ca, environmental_site_profiles: [{ data: null }], monitoring_limits: adoptedAlready() })
    allow(adminGate, db.client)
    expect((await adopt({ keys: [caKeys[0]] })).status).toBe(400)
  })

  it('adopts for one outfall at the site when it is named, and refuses an outfall from another site', async () => {
    const db = fakeSupabase({ ...ca, stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), monitoring_limits: adoptedAlready() })
    allow(adminGate, db.client)
    await adopt({ keys: [caKeys[0]], outfall_id: OUTFALL_ID })
    expect(db.arg('monitoring_limits', 'insert')).toMatchObject({ outfall_id: OUTFALL_ID })

    const elsewhere = fakeSupabase({ ...ca, stormwater_outfalls: rowAt(OTHER_FACILITY, { id: OUTFALL_ID }), monitoring_limits: adoptedAlready() })
    allow(adminGate, elsewhere.client)
    const res = await adopt({ keys: [caKeys[0]], outfall_id: OUTFALL_ID })
    expect(res.status).toBe(400)
    expect((await res.json()).details).toEqual(['outfall_id must be an outfall at this site.'])
    expect(elsewhere.used('monitoring_limits', 'insert')).toEqual([])
  })

  it('answers 403 when the database refuses, and 500 without leaking for anything else', async () => {
    const insertFails = (code: string, message: string) => (call: Call): Result =>
      call.ops.some(o => o.method === 'insert') ? { error: { code, message } } : { data: [] }
    allow(adminGate, fakeSupabase({ ...ca, monitoring_limits: insertFails('42501', 'row-level security') }).client)
    expect((await adopt({ keys: [caKeys[0]] })).status).toBe(403)

    allow(adminGate, fakeSupabase({ ...ca, monitoring_limits: insertFails('XX000', 'relation exploded') }).client)
    const res = await adopt({ keys: [caKeys[0]] })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})
