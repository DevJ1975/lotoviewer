import { describe, it, expect, beforeEach } from 'vitest'
import {
  memberGate, allow, refuse, resetGates, fakeSupabase, jsonRequest, params, sanitized, type Call,
  TENANT, FACILITY, USER,
} from './_harness'
import { applies } from '@soteria/core/environmental/applicability'
import { buildTemplateRows } from '@soteria/core/environmental/checklists'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { EMPTY_SITE_PROFILE } from '@soteria/core/environmental/siteProfile'
import { GET as LIST, POST as START } from '@/app/api/environmental/checklists/route'
import { GET as RUN } from '@/app/api/environmental/checklists/[id]/route'
import { POST as SUBMIT } from '@/app/api/environmental/checklists/[id]/submit/route'

const RUN_ID = '10000000-0000-0000-0000-00000000000b'
const OB = 'c0000000-0000-0000-0000-000000000001'

const facilityRow = { id: FACILITY, name: 'Plant 1', state: 'CA', is_primary: true, settings: {} }
const profileRow = {
  tenant_id: TENANT, facility_id: FACILITY, stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp', air_permit_type: 'minor_permit',
  wastewater_discharge: 'potw_indirect', pretreatment_status: 'not_evaluated', sic_codes: [], naics_codes: [], local_agencies: {},
}
const profile = { ...EMPTY_SITE_PROFILE, stormwaterCoverage: 'general_permit' as const, stormwaterGeneralPermit: 'ca_igp', airPermitType: 'minor_permit' as const, wastewaterDischarge: 'potw_indirect' as const }
const { library, jurisdiction } = libraryForState('CA')
const context = { profile, generatorCategory: null }
const facilityTemplate = library.checklists.find(t => t.subjectType === 'facility' && applies(t.appliesWhen, context))!
const instanceKey = buildTemplateRows(facilityTemplate, context, jurisdiction.chain, { libraryVersion: 'v', lastVerified: null }).companion.jurisdiction_key

beforeEach(resetGates)

const isInsert = (call: Call) => call.ops.some(o => o.method === 'insert')
const isUpdate = (call: Call) => call.ops.some(o => o.method === 'update' || o.method === 'upsert')

describe('GET /api/environmental/checklists', () => {
  const list = (url = '/api/environmental/checklists') => LIST(jsonRequest(url, 'GET'))
  const world = (runs: unknown[] = [], companions: unknown[] = []) => fakeSupabase({
    facilities: [{ data: facilityRow }], environmental_site_profiles: [{ data: profileRow }],
    environmental_checklist_templates: [{ data: companions }], inspections: [{ data: runs }],
  })

  it('passes a gate refusal through', async () => {
    refuse(memberGate, 403, 'Module is not enabled for this tenant')
    expect((await list()).status).toBe(403)
  })

  it('needs a site, because what applies depends on the site', async () => {
    allow(memberGate, world().client, { facilityId: null })
    const res = await list()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('facility_required')
  })

  it('lists the checklists that apply to this site, each with its item count and a due hint', async () => {
    allow(memberGate, world().client, { role: 'member' })
    const { templates } = await (await list()).json()
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.every((t: { item_count: number }) => t.item_count > 0)).toBe(true)
    const mine = templates.find((t: { library_key: string }) => t.library_key === facilityTemplate.id)
    expect(mine).toMatchObject({ name: facilityTemplate.name, template_id: null, last_completed_on: null, due_status: 'never' })
    // Nothing air-related is listed for a site with no air items, and nothing not-applicable leaks in.
    const notApplicable = library.checklists.filter(t => !applies(t.appliesWhen, context)).map(t => t.id)
    expect(templates.map((t: { library_key: string }) => t.library_key).filter((k: string) => notApplicable.includes(k))).toEqual([])
  })

  it('reports when a checklist was last completed, from the most recent submitted run of that template', async () => {
    const runs = [
      { id: 'r2', status: 'in_progress', template_id: 'tpl-1', started_at: '2026-10-01T00:00:00Z', submitted_at: null },
      { id: 'r1', status: 'submitted', template_id: 'tpl-1', started_at: '2026-06-01T00:00:00Z', submitted_at: '2026-06-02T10:00:00Z' },
    ]
    const companions = [{ template_id: 'tpl-1', library_key: facilityTemplate.id, jurisdiction_key: instanceKey }]
    allow(memberGate, world(runs, companions).client)
    const { templates, runs: recent } = await (await list()).json()
    const mine = templates.find((t: { library_key: string }) => t.library_key === facilityTemplate.id)
    expect(mine).toMatchObject({ template_id: 'tpl-1', last_completed_on: '2026-06-02' })
    expect(recent).toHaveLength(2)
  })

  it('scopes to the site in the query string and rejects a malformed one', async () => {
    const db = world()
    allow(memberGate, db.client, { facilityId: null })
    await list(`/api/environmental/checklists?facility_id=${FACILITY}`)
    expect(db.filtered('inspections', 'facility_id', FACILITY)).toBe(true)
    expect(db.filtered('inspections', 'domain', 'environmental')).toBe(true)
    expect((await list('/api/environmental/checklists?facility_id=nope')).status).toBe(400)
  })

  it('answers 404 for a site the caller cannot see', async () => {
    allow(memberGate, fakeSupabase({ facilities: [{ data: null }], environmental_site_profiles: [{ data: null }] }).client)
    expect((await list()).status).toBe(404)
  })
})

describe('POST /api/environmental/checklists', () => {
  const start = (body: unknown) => START(jsonRequest('/api/environmental/checklists', 'POST', body))
  const world = (over: { openRun?: boolean } = {}) => fakeSupabase({
    facilities: [{ data: facilityRow }], environmental_site_profiles: [{ data: profileRow }],
    environmental_checklist_templates: call => isInsert(call) ? { data: null } : { data: { template_id: 'tpl-1' } },
    inspections: call => isInsert(call) ? { data: { id: 'run-new' } } : { data: over.openRun ? [{ id: 'run-open' }] : [] },
    inspection_templates: [{ data: { version: 3 } }],
    environmental_checklist_runs: [{ data: null }],
  })

  it('needs to know which checklist, and says so', async () => {
    allow(memberGate, world().client)
    const res = await start({})
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/library_key/)
  })

  it('needs a site, and rejects malformed ids', async () => {
    allow(memberGate, world().client, { facilityId: null })
    expect((await start({ library_key: facilityTemplate.id })).status).toBe(400)
    allow(memberGate, world().client)
    expect((await start({ library_key: facilityTemplate.id, facility_id: 'nope' })).status).toBe(400)
    expect((await start({ library_key: facilityTemplate.id, obligation_id: 'nope' })).status).toBe(400)
  })

  it('answers 404 for a checklist that is not in the site\'s library', async () => {
    allow(memberGate, world().client)
    expect((await start({ library_key: 'nope' })).status).toBe(404)
  })

  it('starts an environmental run on the site and tells the caller where to go', async () => {
    const db = world()
    allow(memberGate, db.client, { role: 'member' })
    const res = await start({ library_key: facilityTemplate.id })
    expect(res.status, sanitized.map(String).join('; ')).toBe(201)
    expect(await res.json()).toEqual({ inspection_id: 'run-new', resumed: false })
    expect(db.arg('inspections', 'insert')).toMatchObject({
      tenant_id: TENANT, template_id: 'tpl-1', template_version: 3, facility_id: FACILITY, domain: 'environmental',
      status: 'in_progress', created_by: USER, assignee_user_id: USER, subject_type: 'facility', subject_id: FACILITY,
    })
    expect(db.arg('environmental_checklist_runs', 'insert')).toMatchObject({
      inspection_id: 'run-new', tenant_id: TENANT, facility_id: FACILITY, jurisdiction_key: instanceKey,
    })
  })

  it('resumes an unfinished run instead of opening a second one', async () => {
    const db = world({ openRun: true })
    allow(memberGate, db.client)
    const res = await start({ library_key: facilityTemplate.id })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ inspection_id: 'run-open', resumed: true })
    expect(db.used('inspections', 'insert')).toEqual([])
  })

  it('does not leak a database failure', async () => {
    allow(memberGate, fakeSupabase({ facilities: [{ error: { message: 'secret' } }], environmental_site_profiles: [{ data: null }] }).client)
    const res = await start({ library_key: facilityTemplate.id })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})

describe('GET /api/environmental/checklists/[id]', () => {
  const inspectionRow = (over: Record<string, unknown> = {}) => ({
    id: RUN_ID, title: 'Plant visual', status: 'in_progress', domain: 'environmental', template_id: 'tpl-1', facility_id: FACILITY,
    score: null, max_score: null, result: null, subject_type: 'facility', subject_id: FACILITY, ...over,
  })
  const items = [
    { id: 'b', item_type: 'numeric', prompt: 'pH', section: 'Samples', sort_order: 1, required: true, weight: 1, fail_creates_action: true, config: { min: 6, max: 9, unit: 'pH', critical: true } },
    { id: 'a', item_type: 'pass_fail_na', prompt: 'Sheen?', section: 'Observations', sort_order: 0, required: true, weight: 1, fail_creates_action: true, config: { guidance: 'Look at the surface.', citations: [{ ref: 'IGP §XI' }], clause_ref: '9.1.1' } },
  ]
  const world = (inspection: Record<string, unknown> = inspectionRow()) => fakeSupabase({
    inspections: [{ data: inspection }],
    environmental_checklist_runs: [{ data: { obligation_id: null, occurrence_at: null, subject_type: 'facility', subject_id: FACILITY, attested: false, signature: null } }],
    inspection_templates: [{ data: { name: 'Plant visual' } }],
    inspection_template_items: [{ data: items }],
    inspection_responses: [{ data: [] }],
  })
  const get = (id = RUN_ID) => RUN(jsonRequest(`/api/environmental/checklists/${id}`, 'GET'), params({ id }))

  it('rejects a malformed id', async () => {
    allow(memberGate, world().client)
    expect((await get('nope')).status).toBe(400)
  })

  it('shapes the questions for the runner, in order, with guidance, limits and citations', async () => {
    allow(memberGate, world().client, { role: 'member' })
    const body = await (await get()).json()
    expect(body.template_name).toBe('Plant visual')
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['a', 'b'])
    expect(body.items[0]).toMatchObject({ guidance: 'Look at the surface.', clause_ref: '9.1.1', critical: false, citations: [{ ref: 'IGP §XI' }] })
    expect(body.items[1]).toMatchObject({ unit: 'pH', min: 6, max: 9, critical: true, guidance: null })
  })

  it('reports an inspection that is not an environmental checklist as absent', async () => {
    allow(memberGate, world(inspectionRow({ domain: 'safety' })).client)
    expect((await get()).status).toBe(404)
  })

  it('looks the run up within the caller\'s tenant', async () => {
    const db = world()
    allow(memberGate, db.client)
    await get()
    expect(db.filtered('inspections', 'tenant_id', TENANT)).toBe(true)
  })
})

describe('POST /api/environmental/checklists/[id]/submit', () => {
  const submit = (body: unknown, id = RUN_ID) => SUBMIT(jsonRequest(`/api/environmental/checklists/${id}/submit`, 'POST', body), params({ id }))
  const items = [
    { id: 'a', item_type: 'pass_fail_na', prompt: 'Sheen?', section: 'S', sort_order: 0, required: true, weight: 1, fail_creates_action: true, config: { critical: true, clause_ref: '9.1.1', citations: [{ ref: 'IGP §XI' }] } },
  ]
  const world = () => fakeSupabase({
    inspections: call => isUpdate(call) ? { data: [{ id: RUN_ID }] } : { data: {
      id: RUN_ID, title: 'Plant visual', status: 'in_progress', domain: 'environmental', template_id: 'tpl-1', facility_id: FACILITY,
      score: null, max_score: null, result: null, subject_type: 'facility', subject_id: FACILITY,
    } },
    environmental_checklist_runs: call => isUpdate(call) ? { data: null } : { data: { obligation_id: OB, occurrence_at: '2026-09-30', subject_type: 'facility', subject_id: FACILITY, attested: false, signature: null } },
    inspection_templates: [{ data: { name: 'Plant visual' } }],
    inspection_template_items: [{ data: items }],
    inspection_responses: [{ data: [] }],
    compliance_calendar_obligations: call => isUpdate(call) ? { data: null } : { data: {
      id: OB, title: 'Quarterly', status: 'open', cadence: 'quarterly', cadence_days: null, next_due_at: '2026-09-30', due_anchor: 'period_end', owner_user_id: null, facility_id: FACILITY, library_key: null,
    } },
    compliance_calendar_events: [{ data: null }],
    nonconformities: call => isInsert(call) ? { data: null } : { data: [] },
  })
  const good = { attested: true, signature_name: 'Pat Inspector', answers: [{ item_id: 'a', result: 'pass' }] }

  it('rejects an unsigned or unattested submit before touching the database', async () => {
    const db = world()
    allow(memberGate, db.client)
    const res = await submit({ answers: [] })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toMatch(/attested/)
    expect(db.calls).toEqual([])
  })

  it('refuses evidence from another tenant\'s folder before touching the database', async () => {
    const db = world()
    allow(memberGate, db.client)
    const res = await submit({ ...good, answers: [{ item_id: 'a', result: 'pass', evidence_id: '22222222-2222-2222-2222-222222222222/x.jpg' }] })
    expect(res.status).toBe(400)
    expect(db.calls).toEqual([])
  })

  it('submits a clean run end to end: scores it, completes the deadline, signs and closes', async () => {
    const db = world()
    allow(memberGate, db.client, { role: 'member' })
    const res = await submit(good)
    const body = await res.json()
    expect(res.status, sanitized.map(String).join('; ')).toBe(200)
    expect(body).toEqual({ result: 'pass', score: 1, maxScore: 1, pct: 100, findingsRaised: 0, completedObligation: true })
    expect(db.arg('compliance_calendar_events', 'insert')).toMatchObject({ obligation_id: OB, occurrence_at: '2026-09-30', inspection_id: RUN_ID, completed_by: USER })
    const obligationUpdate = db.used('compliance_calendar_obligations', 'update')[0]!.ops.find(o => o.method === 'update')!.args[0]
    expect(obligationUpdate).toMatchObject({ next_due_at: '2026-12-31' })
    const runUpdate = db.used('environmental_checklist_runs', 'update')[0]!.ops.find(o => o.method === 'update')!.args[0] as Record<string, unknown>
    expect(runUpdate).toMatchObject({ attested: true, signature: { name: 'Pat Inspector' } })
    const closed = db.used('inspections', 'update')[0]!
    expect(closed.ops.find(o => o.method === 'update')!.args[0]).toMatchObject({ status: 'submitted', result: 'pass', submitted_by: USER })
    expect(closed.ops).toContainEqual({ method: 'eq', args: ['status', 'in_progress'] })
  })

  it('raises a finding for a failure, tagged with the site and a retry-safe reference', async () => {
    const db = world()
    allow(memberGate, db.client)
    const res = await submit({ ...good, answers: [{ item_id: 'a', result: 'fail', note: 'Oil sheen' }] })
    expect(await res.json()).toMatchObject({ result: 'fail', findingsRaised: 1 })
    expect(db.arg('nonconformities', 'insert')).toEqual([expect.objectContaining({
      tenant_id: TENANT, facility_id: FACILITY, source_type: 'inspection', source_reference: `env-checklist:${RUN_ID}:a`, clause_ref: '9.1.1',
    })])
  })

  it('names the required items that were skipped', async () => {
    allow(memberGate, world().client)
    const res = await submit({ ...good, answers: [] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing_required', items: ['a'] })
  })

  it('refuses a run that is already submitted', async () => {
    const db = fakeSupabase({
      inspections: [{ data: { id: RUN_ID, title: 't', status: 'submitted', domain: 'environmental', template_id: 'tpl-1', facility_id: FACILITY, subject_type: 'facility', subject_id: FACILITY } }],
      environmental_checklist_runs: [{ data: { obligation_id: null, occurrence_at: null, subject_type: 'facility', subject_id: FACILITY, attested: true, signature: {} } }],
      inspection_templates: [{ data: { name: 'x' } }], inspection_template_items: [{ data: items }], inspection_responses: [{ data: [] }],
    })
    allow(memberGate, db.client)
    const res = await submit(good)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_submitted')
  })

  it('does not leak a database failure', async () => {
    allow(memberGate, fakeSupabase({ inspections: [{ error: { message: 'secret relation' } }] }).client)
    const res = await submit(good)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
})
