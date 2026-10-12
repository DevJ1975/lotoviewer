import { describe, it, expect, beforeEach } from 'vitest'
import { memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, TENANT, FACILITY, OTHER_FACILITY } from './_harness'
import { GET } from '@/app/api/environmental/monitoring/summary/route'

const URL = '/api/environmental/monitoring/summary'
const OUTFALL_ID = 'f0000000-0000-0000-0000-0000000000a1'
const NOW = new Date()
// Mid-year in either a calendar or a July-to-June year, so the fixtures are in the current reporting year.
const recent = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate(), 12) - 2 * 60 * 60 * 1000).toISOString()

const limitRow = (over: Record<string, unknown> = {}) => ({
  id: 'l-1', tenant_id: TENANT, facility_id: FACILITY, outfall_id: null, permit_id: null, parameter: 'TSS', unit: 'mg/L', limit_kind: 'instantaneous_max',
  value: 100, basis: 'benchmark', citation: null, verify: null, source: 'tenant', library_key: null, effective_from: null, effective_to: null, ...over,
})
const resultRow = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', tenant_id: TENANT, facility_id: FACILITY, outfall_id: OUTFALL_ID, parameter: 'TSS', unit: 'mg/L', value: 250, below_detection: false,
  sampled_at: recent, event_label: null, lab: null, evidence_id: null, note: null, sampled_by: null, ...over,
})
const tables = (over: Record<string, unknown> = {}) => ({
  facilities: [{ data: { id: FACILITY, name: 'Plant 1', state: 'TX', settings: null } }],
  environmental_site_profiles: [{ data: null }],
  monitoring_limits: [{ data: [limitRow(), limitRow({ id: 'l-2', basis: 'permit_limit', value: 500 })] }],
  monitoring_results: [{ data: [resultRow()] }],
  ...over,
}) as Parameters<typeof fakeSupabase>[0]

beforeEach(resetGates)

describe('GET /api/environmental/monitoring/summary', () => {
  it('passes a gate refusal straight through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await GET(jsonRequest(URL, 'GET'))).status).toBe(403)
  })

  it('answers the active site\'s summary for a plain member, with the permit-limit and benchmark counts apart', async () => {
    const db = fakeSupabase(tables())
    allow(memberGate, db.client, { role: 'member' })
    const res = await GET(jsonRequest(URL, 'GET'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.summary.totals).toEqual({ limit: 0, action: 1, internal: 0 })
    expect(body.summary.rows).toHaveLength(2)
    expect(body.summary.subjects).toEqual([{ outfallId: OUTFALL_ID, counts: { limit: 0, action: 1, internal: 0 } }])
    expect(body.truncated).toBe(false)
    expect(body.reporting_year_basis).toMatchObject({ start_month: 1 })
    expect(body.reporting_year_basis.verify).toMatch(/Confirm/)
  })

  it('reads limits and results for this tenant and this site', async () => {
    const db = fakeSupabase(tables())
    allow(memberGate, db.client)
    await GET(jsonRequest(URL, 'GET'))
    for (const table of ['monitoring_limits', 'monitoring_results']) {
      expect(db.filtered(table, 'tenant_id', TENANT), table).toBe(true)
      expect(db.filtered(table, 'facility_id', FACILITY), table).toBe(true)
    }
  })

  it('prefers ?facility_id over the active site', async () => {
    const db = fakeSupabase(tables())
    allow(memberGate, db.client)
    await GET(jsonRequest(`${URL}?facility_id=${OTHER_FACILITY}`, 'GET'))
    expect(db.filtered('monitoring_results', 'facility_id', OTHER_FACILITY)).toBe(true)
    expect(db.filtered('monitoring_results', 'facility_id', FACILITY)).toBe(false)
  })

  it('needs one site: the reporting year and the limits are a site\'s', async () => {
    const db = fakeSupabase(tables())
    allow(memberGate, db.client, { facilityId: null })
    const res = await GET(jsonRequest(URL, 'GET'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('facility_required')
    expect(db.calls).toEqual([])
  })

  it('rejects a malformed site id before any query', async () => {
    const db = fakeSupabase()
    allow(memberGate, db.client)
    expect((await GET(jsonRequest(`${URL}?facility_id=nope`, 'GET'))).status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('takes the July-to-June year from a site on the California IGP', async () => {
    const db = fakeSupabase(tables({
      facilities: [{ data: { id: FACILITY, name: 'Plant 1', state: 'CA', settings: null } }],
      environmental_site_profiles: [{ data: { facility_id: FACILITY, stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp' } }],
    }))
    allow(memberGate, db.client)
    const body = await (await GET(jsonRequest(URL, 'GET'))).json()
    expect(body.reporting_year_basis.start_month).toBe(7)
    expect(body.summary.reportingYear.reportingYearStart).toMatch(/-07-01$/)
  })

  it('answers 404 for a site that is not there', async () => {
    allow(memberGate, fakeSupabase(tables({ facilities: [{ data: null }] })).client)
    expect((await GET(jsonRequest(URL, 'GET'))).status).toBe(404)
  })

  it('answers 500 without leaking the database error', async () => {
    allow(memberGate, fakeSupabase(tables({ monitoring_results: [{ error: { message: 'relation exploded' } }] })).client)
    const res = await GET(jsonRequest(URL, 'GET'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('exploded')
  })
})
