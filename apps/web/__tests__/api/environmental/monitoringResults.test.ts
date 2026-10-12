import { describe, it, expect, beforeEach } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params,
  TENANT, FACILITY, OTHER_FACILITY, USER, type Call, type Result,
} from './_harness'
import { GET, POST } from '@/app/api/environmental/monitoring/results/route'
import { PATCH, DELETE } from '@/app/api/environmental/monitoring/results/[id]/route'

const RESULT_ID = 'f0000000-0000-0000-0000-0000000000c1'
const OUTFALL_ID = 'f0000000-0000-0000-0000-0000000000a1'
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222'
const URL = '/api/environmental/monitoring/results'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR_MS).toISOString()

const resultRow = (over: Record<string, unknown> = {}) => ({
  id: RESULT_ID, tenant_id: TENANT, facility_id: FACILITY, outfall_id: OUTFALL_ID, parameter: 'TSS', unit: 'mg/L', value: 42, below_detection: false,
  sampled_at: '2026-02-03T10:00:00+00:00', event_label: null, lab: null, evidence_id: null, note: 'old note', sampled_by: USER, ...over,
})

const validBody = (over: Record<string, unknown> = {}) => ({ parameter: 'TSS', unit: 'mg/L', value: 42, sampled_at: hoursAgo(2), ...over })

// ── scripting the fake database ─────────────────────────────────────────────
const hasOp = (call: Call, method: string) => call.ops.some(o => o.method === method)
const eqValue = (call: Call, column: string) => call.ops.find(o => o.method === 'eq' && o.args[0] === column)?.args[1]
const opArgs = (call: Call, method: string) => call.ops.filter(o => o.method === method).map(o => o.args)

const rowAt = (site: string, row: object) => (call: Call): Result => {
  const filtered = eqValue(call, 'facility_id')
  return { data: filtered === undefined || filtered === site ? row : null }
}

const resultsTable = (o: { stored?: Result; saved?: Result } = {}) => (call: Call): Result => {
  if (hasOp(call, 'insert') || hasOp(call, 'update')) return o.saved ?? { data: resultRow() }
  return o.stored ?? { data: resultRow() }
}

beforeEach(resetGates)

describe('GET /api/environmental/monitoring/results', () => {
  it('passes a gate refusal straight through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await GET(jsonRequest(URL, 'GET'))).status).toBe(403)
  })

  it('lists the active site\'s results, newest first, a page at a time, for a plain member', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: [resultRow(), resultRow({ id: 'r2' })] }] })
    allow(memberGate, db.client, { role: 'member' })
    const res = await GET(jsonRequest(URL, 'GET'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(2)
    expect(body.next_cursor).toBeNull()
    const [call] = db.calls
    expect(eqValue(call!, 'tenant_id')).toBe(TENANT)
    expect(eqValue(call!, 'facility_id')).toBe(FACILITY)
    expect(opArgs(call!, 'order')).toEqual([['sampled_at', { ascending: false }], ['id', { ascending: false }]])
  })

  it('never returns unbounded rows: a page of 50 unless asked for less or more, at most 200, read as one extra to see if there is more', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(URL, 'GET'))
    await GET(jsonRequest(`${URL}?limit=10`, 'GET'))
    await GET(jsonRequest(`${URL}?limit=200`, 'GET'))
    expect(db.calls.map(c => opArgs(c, 'limit')[0]![0])).toEqual([51, 11, 201])
    expect((await GET(jsonRequest(`${URL}?limit=201`, 'GET'))).status).toBe(400)
    expect((await GET(jsonRequest(`${URL}?limit=0`, 'GET'))).status).toBe(400)
  })

  it('answers a cursor when there is another page, and the page without its extra row', async () => {
    const rows = [
      resultRow({ id: 'a1111111-0000-0000-0000-000000000003', sampled_at: '2026-02-03T10:00:00+00:00' }),
      resultRow({ id: 'a1111111-0000-0000-0000-000000000002', sampled_at: '2026-02-02T10:00:00+00:00' }),
      resultRow({ id: 'a1111111-0000-0000-0000-000000000001', sampled_at: '2026-02-01T10:00:00+00:00' }),
    ]
    allow(memberGate, fakeSupabase({ monitoring_results: [{ data: rows }] }).client)
    const body = await (await GET(jsonRequest(`${URL}?limit=2`, 'GET'))).json()
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([rows[0]!.id, rows[1]!.id])
    expect(body.next_cursor).toBe(`2026-02-02T10:00:00+00:00|${rows[1]!.id}`)
  })

  it('has no cursor on the last page, however full', async () => {
    allow(memberGate, fakeSupabase({ monitoring_results: [{ data: [resultRow(), resultRow({ id: 'r2' })] }] }).client)
    expect((await (await GET(jsonRequest(`${URL}?limit=2`, 'GET'))).json()).next_cursor).toBeNull()
  })

  it('continues strictly after the cursor in (time, id) order', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: [] }] })
    allow(memberGate, db.client)
    const id = 'a1111111-0000-0000-0000-000000000002'
    await GET(jsonRequest(`${URL}?cursor=${encodeURIComponent(`2026-02-02T10:00:00+00:00|${id}`)}`, 'GET'))
    expect(opArgs(db.calls[0]!, 'or')).toEqual([[`sampled_at.lt.2026-02-02T10:00:00+00:00,and(sampled_at.eq.2026-02-02T10:00:00+00:00,id.lt.${id})`]])
  })

  it('refuses a cursor that is not one it gave out, before any query: it goes into a filter', async () => {
    const db = fakeSupabase()
    allow(memberGate, db.client)
    const attack = encodeURIComponent('2026-02-03T10:00:00Z),tenant_id.neq.x,and(id.gt.0|f0000000-0000-0000-0000-0000000000a1')
    const res = await GET(jsonRequest(`${URL}?cursor=${attack}`, 'GET'))
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('filters by outfall, parameter and a range of days, the last day included', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(`${URL}?outfall_id=${OUTFALL_ID}&parameter=Oil%20%26%20grease&from=2026-01-01&to=2026-01-31`, 'GET'))
    const [call] = db.calls
    expect(eqValue(call!, 'outfall_id')).toBe(OUTFALL_ID)
    expect(eqValue(call!, 'parameter')).toBe('Oil & grease')
    expect(opArgs(call!, 'gte')).toEqual([['sampled_at', '2026-01-01T00:00:00.000Z']])
    expect(opArgs(call!, 'lt')).toEqual([['sampled_at', '2026-02-01T00:00:00.000Z']])
  })

  it('prefers ?facility_id over the active site, and shows every site in roll-up mode, inside the tenant', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: [] }] })
    allow(memberGate, db.client)
    await GET(jsonRequest(`${URL}?facility_id=${OTHER_FACILITY}`, 'GET'))
    expect(db.filtered('monitoring_results', 'facility_id', OTHER_FACILITY)).toBe(true)
    expect(db.filtered('monitoring_results', 'facility_id', FACILITY)).toBe(false)

    const rollup = fakeSupabase({ monitoring_results: [{ data: [] }] })
    allow(memberGate, rollup.client, { facilityId: null })
    await GET(jsonRequest(URL, 'GET'))
    expect(rollup.calls[0]!.ops.some(o => o.method === 'eq' && o.args[0] === 'facility_id')).toBe(false)
    expect(rollup.filtered('monitoring_results', 'tenant_id', TENANT)).toBe(true)
  })

  it('rejects a malformed filter with every problem, before any query', async () => {
    const db = fakeSupabase()
    allow(memberGate, db.client)
    const res = await GET(jsonRequest(`${URL}?outfall_id=nope&from=2026-02-30`, 'GET'))
    expect(res.status).toBe(400)
    expect((await res.json()).details).toHaveLength(2)
    expect(db.calls).toEqual([])
  })

  it('answers an empty list, not null, and 500 without leaking the database error', async () => {
    allow(memberGate, fakeSupabase({ monitoring_results: [{ data: null }] }).client)
    expect((await (await GET(jsonRequest(URL, 'GET'))).json()).results).toEqual([])

    allow(memberGate, fakeSupabase({ monitoring_results: [{ error: { message: 'relation exploded' } }] }).client)
    const res = await GET(jsonRequest(URL, 'GET'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('POST /api/environmental/monitoring/results', () => {
  const post = (body: Record<string, unknown> = {}) => POST(jsonRequest(URL, 'POST', validBody(body)))

  it('is for any member: a plain member records a result, as themselves', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: resultRow() }] })
    allow(memberGate, db.client, { role: 'member' })
    const res = await post()
    expect(res.status).toBe(201)
    expect((await res.json()).result.id).toBe(RESULT_ID)
    expect(adminGate).not.toHaveBeenCalled()
    expect(db.arg('monitoring_results', 'insert')).toMatchObject({ tenant_id: TENANT, facility_id: FACILITY, sampled_by: USER })
  })

  it('stops at the gate before any query', async () => {
    const db = fakeSupabase()
    refuse(memberGate, 403, 'Not a member of this tenant')
    expect((await post()).status).toBe(403)
    expect(db.calls).toEqual([])
  })

  it('records exactly what the sampler entered, with the time stored in UTC', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: resultRow() }] })
    allow(memberGate, db.client)
    await post({ outfall_id: null, below_detection: true, sampled_at: '2026-02-03T10:30:00-08:00', event_label: 'QSE 2026-02-03', lab: 'Acme Labs', note: ' n ' })
    expect(db.arg('monitoring_results', 'insert')).toEqual({
      tenant_id: TENANT, sampled_by: USER, facility_id: FACILITY, outfall_id: null, parameter: 'TSS', unit: 'mg/L', value: 42,
      below_detection: true, sampled_at: '2026-02-03T18:30:00.000Z', event_label: 'QSE 2026-02-03', lab: 'Acme Labs', evidence_id: null, note: 'n',
    })
  })

  it('takes who sampled and which tenant from the session, never from the body', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: resultRow() }] })
    allow(memberGate, db.client)
    await post({ sampled_by: 'someone-else', tenant_id: OTHER_TENANT, created_at: '2000-01-01T00:00:00Z' })
    const inserted = db.arg('monitoring_results', 'insert') as Record<string, unknown>
    expect(inserted).toMatchObject({ tenant_id: TENANT, sampled_by: USER })
    expect(inserted).not.toHaveProperty('created_at')
  })

  it('rejects malformed JSON, and an invalid result with every problem listed, before any query', async () => {
    const db = fakeSupabase()
    allow(memberGate, db.client)
    const bad = await POST(new Request('https://example.com/x', { method: 'POST', body: '{' }))
    expect((await bad.json()).error).toBe('invalid_json')

    const res = await POST(jsonRequest(URL, 'POST', { parameter: '', unit: '', value: -1, sampled_at: 'yesterday' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.details).toHaveLength(4)
    expect(db.calls).toEqual([])
  })

  describe('when the sample was taken', () => {
    it('refuses a date more than a day ahead, and records nothing', async () => {
      const db = fakeSupabase()
      allow(memberGate, db.client)
      const res = await post({ sampled_at: new Date(Date.now() + 2 * DAY_MS).toISOString() })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: ['sampled_at cannot be more than a day in the future.'] })
      expect(db.calls).toEqual([])
    })

    it('allows a few hours ahead (another time zone, a fast clock) and any time in the past', async () => {
      const db = fakeSupabase({ monitoring_results: [{ data: resultRow() }] })
      allow(memberGate, db.client)
      expect((await post({ sampled_at: new Date(Date.now() + 5 * HOUR_MS).toISOString() })).status).toBe(201)
      expect((await post({ sampled_at: '2019-05-01T08:00:00Z' })).status).toBe(201)
    })

    it('needs a time with a zone: a date alone is not an instant', async () => {
      allow(memberGate, fakeSupabase().client)
      expect((await post({ sampled_at: '2026-02-03' })).status).toBe(400)
      expect((await post({ sampled_at: undefined })).status).toBe(400)
    })
  })

  describe('the evidence file', () => {
    it('is refused when it is in another tenant\'s folder, or climbs out of its own, and nothing is recorded', async () => {
      const db = fakeSupabase()
      allow(memberGate, db.client)
      for (const evidence_id of [`${OTHER_TENANT}/monitoring/lab.pdf`, `${TENANT}/../${OTHER_TENANT}/lab.pdf`, 'lab.pdf', `${TENANT}/${'a'.repeat(300)}`]) {
        const res = await post({ evidence_id })
        expect(res.status, evidence_id).toBe(400)
        expect(await res.json()).toEqual({ error: 'invalid', details: ['evidence_id must be a file you uploaded to this account.'] })
      }
      expect(db.calls).toEqual([])
    })

    it('is stored when it is in the tenant\'s own folder', async () => {
      const db = fakeSupabase({ monitoring_results: [{ data: resultRow() }] })
      allow(memberGate, db.client)
      expect((await post({ evidence_id: `${TENANT}/monitoring/lab-1.pdf` })).status).toBe(201)
      expect(db.arg('monitoring_results', 'insert')).toMatchObject({ evidence_id: `${TENANT}/monitoring/lab-1.pdf` })
    })
  })

  it('needs a site: with none active and none given, it says so', async () => {
    const db = fakeSupabase();
    allow(memberGate, db.client, { facilityId: null })
    const res = await post()
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/facility_id/)
    expect(db.calls).toEqual([])
  })

  describe('the outfall', () => {
    it('needs no lookup when it is a sample of the site as a whole', async () => {
      const db = fakeSupabase({ monitoring_results: [{ data: resultRow() }] })
      allow(memberGate, db.client)
      await post()
      expect(db.calls.map(c => c.table)).toEqual(['monitoring_results'])
    })

    it('is accepted at the same site, looked up on that site inside the tenant', async () => {
      const db = fakeSupabase({ stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), monitoring_results: [{ data: resultRow() }] })
      allow(memberGate, db.client)
      expect((await post({ outfall_id: OUTFALL_ID })).status).toBe(201)
      expect(db.filtered('stormwater_outfalls', 'tenant_id', TENANT)).toBe(true)
      expect(db.filtered('stormwater_outfalls', 'facility_id', FACILITY)).toBe(true)
    })

    it('is refused at another site, and nothing is recorded', async () => {
      const db = fakeSupabase({ stormwater_outfalls: rowAt(OTHER_FACILITY, { id: OUTFALL_ID }) })
      allow(memberGate, db.client)
      const res = await post({ outfall_id: OUTFALL_ID })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', details: ['outfall_id must be an outfall at this site.'] })
      expect(db.used('monitoring_results', 'insert')).toEqual([])
    })
  })

  describe('when the database refuses', () => {
    const refusedWith = async (code: string, message: string) => {
      allow(memberGate, fakeSupabase({ monitoring_results: [{ error: { code, message } }] }).client)
      const res = await post()
      return { status: res.status, body: await res.json() }
    }

    it('maps 23503 to a 400 with a field message, 23514 to 400, 23505 to 409 and 42501 to 403', async () => {
      expect(await refusedWith('23503', 'violates foreign key constraint "monitoring_results_outfall_fk"')).toEqual({
        status: 400, body: { error: 'invalid', details: ['outfall_id must be an outfall at this site.'] },
      })
      expect(await refusedWith('23514', 'violates check constraint "monitoring_results_evidence_in_tenant_folder"')).toMatchObject({ status: 400 })
      expect(await refusedWith('23505', 'duplicate key')).toMatchObject({ status: 409 })
      expect(await refusedWith('42501', 'new row violates row-level security policy')).toMatchObject({ status: 403 })
    })

    it('answers 500 for anything else, without leaking it', async () => {
      const { status, body } = await refusedWith('XX000', 'relation "monitoring_results" exploded')
      expect(status).toBe(500)
      expect(JSON.stringify(body)).not.toMatch(/exploded|monitoring_results/)
    })
  })
})

describe('PATCH /api/environmental/monitoring/results/[id]', () => {
  const patch = (body: unknown, id = RESULT_ID) => PATCH(jsonRequest(`${URL}/${id}`, 'PATCH', body), params({ id }))

  it('is admin-only: a member cannot correct a result, not even their own', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await patch({ value: 1 })).status).toBe(403)
    expect(memberGate).not.toHaveBeenCalled()
  })

  it('rejects a malformed id before any query, and malformed JSON', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await patch({}, 'nope')).status).toBe(400)
    expect(db.calls).toEqual([])
    const res = await PATCH(new Request('https://example.com/x', { method: 'PATCH', body: '{' }), params({ id: RESULT_ID }))
    expect((await res.json()).error).toBe('invalid_json')
  })

  it('answers 404 for a result that is not there, and updates nothing', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await patch({ value: 1 })).status).toBe(404)
    expect(db.used('monitoring_results', 'update')).toEqual([])
  })

  it('changes only what was sent, keeps the site and the sampler, and ignores a site in the body', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), monitoring_results: resultsTable({ saved: { data: resultRow({ value: 43 }) } }) })
    allow(adminGate, db.client)
    const res = await patch({ value: 43, facility_id: OTHER_FACILITY, sampled_by: 'someone-else', note: 'Corrected from the lab report' })
    expect(res.status).toBe(200)
    const sent = db.arg('monitoring_results', 'update') as Record<string, unknown>
    expect(sent).toEqual({
      facility_id: FACILITY, outfall_id: OUTFALL_ID, parameter: 'TSS', unit: 'mg/L', value: 43, below_detection: false,
      sampled_at: '2026-02-03T10:00:00.000Z', event_label: null, lab: null, evidence_id: null, note: 'Corrected from the lab report',
    })
    expect(sent).not.toHaveProperty('sampled_by')
    expect(sent).not.toHaveProperty('tenant_id')
  })

  it('scopes the read and the write to the tenant and the result', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), monitoring_results: resultsTable() })
    allow(adminGate, db.client)
    await patch({ value: 1 })
    const own = db.calls.filter(c => c.table === 'monitoring_results')
    expect(own).toHaveLength(2)
    for (const call of own) {
      expect(eqValue(call, 'tenant_id')).toBe(TENANT)
      expect(eqValue(call, 'id')).toBe(RESULT_ID)
    }
  })

  it('refuses an edit that makes the result invalid or points its evidence at another tenant, and updates nothing', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), monitoring_results: resultsTable() })
    allow(adminGate, db.client)
    const res = await patch({ value: -1, evidence_id: `${OTHER_TENANT}/lab.pdf`, sampled_at: new Date(Date.now() + 5 * DAY_MS).toISOString() })
    expect(res.status).toBe(400)
    expect((await res.json()).details).toHaveLength(3)
    expect(db.used('monitoring_results', 'update')).toEqual([])
  })

  it('judges an outfall against the result\'s own site', async () => {
    const db = fakeSupabase({ stormwater_outfalls: rowAt(OTHER_FACILITY, { id: OUTFALL_ID }), monitoring_results: resultsTable({ stored: { data: resultRow({ outfall_id: null }) } }) })
    allow(adminGate, db.client)
    expect((await patch({ outfall_id: OUTFALL_ID, facility_id: OTHER_FACILITY })).status).toBe(400)
    expect(db.filtered('stormwater_outfalls', 'facility_id', FACILITY)).toBe(true)
    expect(db.used('monitoring_results', 'update')).toEqual([])
  })

  it('answers 500 without leaking the database error', async () => {
    allow(adminGate, fakeSupabase({ stormwater_outfalls: rowAt(FACILITY, { id: OUTFALL_ID }), monitoring_results: resultsTable({ saved: { error: { code: 'XX000', message: 'relation exploded' } } }) }).client)
    const res = await patch({ value: 1 })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})

describe('DELETE /api/environmental/monitoring/results/[id]', () => {
  const remove = (id = RESULT_ID) => DELETE(jsonRequest(`${URL}/${id}`, 'DELETE'), params({ id }))

  it('is admin-only: a member cannot delete a result, not even their own', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await remove()).status).toBe(403)
    expect(memberGate).not.toHaveBeenCalled()
  })

  it('rejects a malformed id before any query', async () => {
    const db = fakeSupabase()
    allow(adminGate, db.client)
    expect((await remove('nope')).status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('answers 404 for a result that is not there, and deletes nothing', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: null }] })
    allow(adminGate, db.client)
    expect((await remove()).status).toBe(404)
    expect(db.used('monitoring_results', 'delete')).toEqual([])
  })

  it('deletes the result within the tenant', async () => {
    const db = fakeSupabase({ monitoring_results: [{ data: { id: RESULT_ID } }, { data: null }] })
    allow(adminGate, db.client)
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const [deletion] = db.used('monitoring_results', 'delete')
    expect(eqValue(deletion!, 'tenant_id')).toBe(TENANT)
    expect(eqValue(deletion!, 'id')).toBe(RESULT_ID)
  })

  it('answers 403 when the database refuses by policy, and 500 without leaking for anything else', async () => {
    allow(adminGate, fakeSupabase({ monitoring_results: [{ data: { id: RESULT_ID } }, { error: { code: '42501', message: 'denied' } }] }).client)
    expect((await remove()).status).toBe(403)

    allow(adminGate, fakeSupabase({ monitoring_results: [{ data: { id: RESULT_ID } }, { error: { message: 'relation exploded' } }] }).client)
    const res = await remove()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})
