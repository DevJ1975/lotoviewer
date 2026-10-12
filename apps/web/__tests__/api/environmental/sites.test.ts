import { describe, it, expect, beforeEach } from 'vitest'
import {
  adminGate, memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params,
  TENANT, FACILITY, USER, sanitized,
} from './_harness'
import { GET as LIST_SITES } from '@/app/api/environmental/sites/route'
import { GET as GET_PROFILE, PUT as PUT_PROFILE } from '@/app/api/environmental/sites/[facilityId]/profile/route'
import { POST as APPLY } from '@/app/api/environmental/sites/[facilityId]/apply-library/route'

const facilityRow = (over: Record<string, unknown> = {}) => ({ id: FACILITY, name: 'Plant 1', state: 'CA', is_primary: true, settings: {}, ...over })
const profileRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', tenant_id: TENANT, facility_id: FACILITY, stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp',
  sic_codes: [], naics_codes: [], air_permit_type: 'not_evaluated', wastewater_discharge: 'not_evaluated', pretreatment_status: 'not_evaluated',
  potw_name: null, local_agencies: {}, spcc_applicable: null, tier2_applicable: null, notes: null, confirmed_at: null, ...over,
})

beforeEach(resetGates)

describe('GET /api/environmental/sites', () => {
  it('passes a gate refusal through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await LIST_SITES(jsonRequest('/api/environmental/sites', 'GET'))).status).toBe(403)
  })

  it('lists every site with its jurisdiction, fallback notice and program scope', async () => {
    const db = fakeSupabase({
      facilities: [{ data: [
        facilityRow(),
        facilityRow({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Plant 2', state: 'OR', is_primary: false }),
        facilityRow({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'Plant 3', state: null, is_primary: false }),
      ] }],
      environmental_site_profiles: [{ data: [profileRow()] }],
    })
    allow(memberGate, db.client, { role: 'member', facilityId: null })
    const { sites } = await (await LIST_SITES(jsonRequest('/api/environmental/sites', 'GET'))).json()

    expect(sites.map((s: { name: string }) => s.name)).toEqual(['Plant 1', 'Plant 2', 'Plant 3'])
    expect(sites[0]).toMatchObject({ state: 'CA', jurisdiction: { chain: ['federal', 'CA'], status: 'supported' }, notice: null, profile_saved: true })
    expect(sites[0].scopes.find((s: { program: string }) => s.program === 'stormwater').status).toBe('in_scope')
    // A state with no pack falls back to the federal baseline and says so.
    expect(sites[1]).toMatchObject({ jurisdiction: { chain: ['federal'], status: 'unsupported' }, profile_saved: false })
    expect(sites[1].notice).toMatch(/federal baseline only/)
    expect(sites[2]).toMatchObject({ jurisdiction: { status: 'unset' } })
    expect(sites[2].notice).toMatch(/No state is set/)
  })

  it('reads the generator category the hazardous waste module owns', async () => {
    const db = fakeSupabase({
      facilities: [{ data: [facilityRow({ settings: { hazardous_waste: { generator_category: 'lqg' } } })] }],
      environmental_site_profiles: [{ data: [] }],
    })
    allow(memberGate, db.client)
    const { sites } = await (await LIST_SITES(jsonRequest('/api/environmental/sites', 'GET'))).json()
    expect(sites[0].generator_category).toBe('lqg')
  })
})

describe('GET /api/environmental/sites/[facilityId]/profile', () => {
  const get = (id = FACILITY) => GET_PROFILE(jsonRequest(`/api/environmental/sites/${id}/profile`, 'GET'), params({ facilityId: id }))

  it('rejects a malformed id and answers 404 for a site the caller cannot see', async () => {
    allow(memberGate, fakeSupabase({ facilities: [{ data: null }], environmental_site_profiles: [{ data: null }] }).client)
    expect((await get('nope')).status).toBe(400)
    expect((await get()).status).toBe(404)
  })

  it('returns the profile, the pack status and the state dropdown', async () => {
    allow(memberGate, fakeSupabase({ facilities: [{ data: facilityRow() }], environmental_site_profiles: [{ data: profileRow() }] }).client)
    const body = await (await get()).json()
    expect(body.profile).toMatchObject({ stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp' })
    expect(body.packs.map((p: { jurisdiction: string }) => p.jurisdiction)).toEqual(['federal', 'CA'])
    expect(body.packs.every((p: { status: string }) => p.status === 'draft')).toBe(true)
    const states = body.states as Array<{ code: string; supported: boolean }>
    expect(states.find(s => s.code === 'CA')!.supported).toBe(true)
    expect(states.find(s => s.code === 'TX')!.supported).toBe(true)
    expect(states.find(s => s.code === 'OR')!.supported).toBe(false)
  })
})

describe('PUT /api/environmental/sites/[facilityId]/profile', () => {
  const put = (body: unknown, id = FACILITY) => PUT_PROFILE(jsonRequest(`/api/environmental/sites/${id}/profile`, 'PUT', body), params({ facilityId: id }))
  const world = (over: { facility?: Record<string, unknown>; profile?: Record<string, unknown> | null; updated?: unknown[] } = {}) => fakeSupabase({
    facilities: [{ data: over.facility ?? facilityRow() }, { data: over.updated ?? [{ id: FACILITY }] }, { data: over.facility ?? facilityRow() }],
    environmental_site_profiles: [{ data: over.profile === undefined ? profileRow() : over.profile }],
  })

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await put({})).status).toBe(403)
  })

  it('rejects malformed JSON, a body that is not an object, a bad state, and unknown profile values', async () => {
    allow(adminGate, world().client)
    expect((await PUT_PROFILE(new Request('https://example.com/x', { method: 'PUT', body: '{' }), params({ facilityId: FACILITY }))).status).toBe(400)
    expect((await put([])).status).toBe(400)
    expect((await put({ state: 'Atlantis' })).status).toBe(400)
    expect((await put({ stormwater_coverage: 'sometimes' })).status).toBe(400)
  })

  it('sets the state from the dropdown and reports that it changed the facility', async () => {
    const db = world({ facility: facilityRow({ state: null }) })
    allow(adminGate, db.client)
    const res = await put({ state: 'tx' })
    expect(res.status).toBe(200)
    expect(db.arg('facilities', 'update')).toEqual({ state: 'TX' })
    expect((await res.json()).state_changed).toBe(true)
  })

  it('accepts a state\'s full name and stores its code', async () => {
    const db = world({ facility: facilityRow({ state: null }) })
    allow(adminGate, db.client)
    await put({ state: 'Texas' })
    expect(db.arg('facilities', 'update')).toEqual({ state: 'TX' })
  })

  it('clears the state when told to, falling back to the federal baseline', async () => {
    const db = world()
    allow(adminGate, db.client)
    await put({ state: null })
    expect(db.arg('facilities', 'update')).toEqual({ state: null })
  })

  it('does not touch the facility when the state is unchanged', async () => {
    const db = world()
    allow(adminGate, db.client)
    const res = await put({ state: 'CA', notes: 'x' })
    expect(db.used('facilities', 'update')).toEqual([])
    expect((await res.json()).state_changed).toBe(false)
  })

  it('reports a refused state change instead of pretending it saved', async () => {
    allow(adminGate, world({ updated: [] }).client)
    const res = await put({ state: 'TX' })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('facility_update_refused')
  })

  it('creates the profile the first time and stamps who created it', async () => {
    const db = world({ profile: null })
    allow(adminGate, db.client)
    await put({ stormwater_coverage: 'no_exposure' })
    expect(db.arg('environmental_site_profiles', 'insert')).toMatchObject({
      tenant_id: TENANT, facility_id: FACILITY, stormwater_coverage: 'no_exposure', created_by: USER, updated_by: USER,
    })
  })

  it('updates an existing profile without rewriting who created it', async () => {
    const db = world()
    allow(adminGate, db.client)
    await put({ air_permit_type: 'title_v' })
    const sent = db.arg('environmental_site_profiles', 'update') as Record<string, unknown>
    expect(sent).toMatchObject({ air_permit_type: 'title_v', updated_by: USER })
    expect(sent).not.toHaveProperty('created_by')
  })

  it('records a confirmation, and withdraws it when the answers change without being confirmed again', async () => {
    const confirmed = world()
    allow(adminGate, confirmed.client)
    await put({ confirm: true })
    expect(confirmed.arg('environmental_site_profiles', 'update')).toMatchObject({ confirmed_by: USER })

    const edited = world({ profile: profileRow({ confirmed_at: '2026-09-01T00:00:00Z' }) })
    allow(adminGate, edited.client)
    await put({ air_permit_type: 'title_v' })
    expect(edited.arg('environmental_site_profiles', 'update')).toMatchObject({ confirmed_at: null, confirmed_by: null })
  })

  it('writes nothing when nothing changed', async () => {
    const db = world()
    allow(adminGate, db.client)
    expect((await put({})).status).toBe(200)
    expect(db.used('environmental_site_profiles', 'update')).toEqual([])
    expect(db.used('environmental_site_profiles', 'insert')).toEqual([])
  })

  it('answers 409 when two admins create the profile at once', async () => {
    const db = fakeSupabase({
      facilities: [{ data: facilityRow() }],
      environmental_site_profiles: [{ data: null }, { error: { message: 'dup', code: '23505' } }],
    })
    allow(adminGate, db.client)
    expect((await put({ stormwater_coverage: 'no_exposure' })).status).toBe(409)
  })

  it('answers 404 for a site the caller cannot see', async () => {
    allow(adminGate, fakeSupabase({ facilities: [{ data: null }], environmental_site_profiles: [{ data: null }] }).client)
    expect((await put({ state: 'TX' })).status).toBe(404)
  })
})

describe('POST /api/environmental/sites/[facilityId]/apply-library', () => {
  const apply = (body: unknown, id = FACILITY) => APPLY(jsonRequest(`/api/environmental/sites/${id}/apply-library`, 'POST', body), params({ facilityId: id }))
  // A read returns the (empty) site; an insert returns the new row.
  const readsEmptyInsertsOne = (inserted: unknown) => (call: { ops: Array<{ method: string }> }) =>
    call.ops.some(o => o.method === 'insert') ? { data: inserted } : { data: [] }
  const world = () => fakeSupabase({
    facilities: [{ data: facilityRow() }],
    environmental_site_profiles: [{ data: profileRow({ air_permit_type: 'minor_permit' }) }],
    legal_register: readsEmptyInsertsOne({ id: 'leg-1' }),
    compliance_calendar_obligations: readsEmptyInsertsOne(null),
    environmental_checklist_templates: call => call.ops.some(o => o.method === 'insert') ? { data: null } : { data: [] },
    inspection_templates: [{ data: { id: 'tpl-1' } }],
    inspection_template_items: [{ data: null }],
  })

  it('is admin-only', async () => {
    refuse(adminGate, 403, 'Tenant admin or owner required')
    expect((await apply({})).status).toBe(403)
  })

  it('defaults to a dry run: it returns the plan and writes nothing at all', async () => {
    const db = world()
    allow(adminGate, db.client)
    for (const body of [{}, { dry_run: true }, { dry_run: 'no' }]) {
      const res = await apply(body)
      const out = await res.json()
      expect(res.status, sanitized.map(String).join('; ')).toBe(200)
      expect(out.dry_run).toBe(true)
      expect(out.plan.legal.create.length).toBeGreaterThan(0)
      expect(out.plan.obligations.create.length).toBeGreaterThan(0)
    }
    for (const method of ['insert', 'update', 'upsert', 'delete']) {
      expect(db.calls.filter(c => c.ops.some(o => o.method === method))).toEqual([])
    }
  })

  it('shows the packs are drafts, so the screen can say the content awaits review', async () => {
    allow(adminGate, world().client)
    const out = await (await apply({})).json()
    expect(out.packs).toEqual([
      expect.objectContaining({ jurisdiction: 'federal', status: 'draft', last_verified: null }),
      expect.objectContaining({ jurisdiction: 'CA', status: 'draft', last_verified: null }),
    ])
  })

  it('writes only when dry_run is explicitly false, for this site, as this user', async () => {
    const db = world()
    allow(adminGate, db.client)
    const res = await apply({ dry_run: false })
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.dry_run).toBe(false)
    expect(out.result.obligations.created).toBeGreaterThan(0)
    expect(db.arg('compliance_calendar_obligations', 'insert')).toMatchObject({ tenant_id: TENANT, facility_id: FACILITY, source: 'library', created_by: USER })
    expect(db.arg('legal_register', 'insert')).toMatchObject({ tenant_id: TENANT, facility_id: FACILITY, source: 'library' })
  })

  it('answers 404 for a site the caller cannot see and 400 for a malformed id', async () => {
    allow(adminGate, fakeSupabase({ facilities: [{ data: null }], environmental_site_profiles: [{ data: null }] }).client)
    expect((await apply({})).status).toBe(404)
    expect((await apply({}, 'nope')).status).toBe(400)
  })

  it('does not leak a database failure from the write phase', async () => {
    const db = fakeSupabase({
      facilities: [{ data: facilityRow() }], environmental_site_profiles: [{ data: profileRow() }],
      legal_register: call => call.ops.some(o => o.method === 'insert') ? { error: { message: 'secret table name', code: 'XX000' } } : { data: [] },
      compliance_calendar_obligations: [{ data: [] }], environmental_checklist_templates: [{ data: [] }],
      inspection_templates: [{ data: { id: 'tpl-1' } }], inspection_template_items: [{ data: null }],
    })
    allow(adminGate, db.client)
    const res = await apply({ dry_run: false })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
