// Management of change behind /api/environmental/changes (Phase 2 plan D12-D14): a change
// opens with the impacts the core fan-out works out, in one database call; the checklist is
// described with the same rules the database enforces; resolving, closing and cancelling
// map the database's plain-words refusals to 409. Every read stays inside the caller's tenant.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ADMIN_A, FACILITY_A, TENANT_A, TENANT_B,
  asAdminB, asMemberA, beforeNext, callAs, failNext, gateRejects, idContext, jsonRequest, onRpc, resetStore, rowsIn,
  rpcCalls, seed, writes,
} from './_emsHarness'

import * as changes from '@/app/api/environmental/changes/route'
import * as change from '@/app/api/environmental/changes/[id]/route'
import * as resolve from '@/app/api/environmental/changes/[id]/impacts/[impactId]/resolve/route'

const NEW_ENTITY = 'Northfield Forge & Finish Holdings LLC'
const OLD_ENTITY = 'Northfield Metal Products Inc.'
const SITE_B = '44444444-4444-4444-8444-444444444444'
const CHANGE = 'c0000000-0000-4000-8000-00000000000a'
const OTHER_TENANT_CHANGE = 'c0000000-0000-4000-8000-00000000000b'
const IMPACT = 'c1000000-0000-4000-8000-00000000000a'
const OTHER_TENANT_IMPACT = 'c1000000-0000-4000-8000-0000000000b0'
const PERMIT_AIR = 'f0000000-0000-4000-8000-0000000000a1'
const PERMIT_WATER = 'f0000000-0000-4000-8000-0000000000a2'
const PERMIT_SITE_B = 'f0000000-0000-4000-8000-0000000000b1'

const rollUp = () => callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin', facilityId: null })
const ownershipChange = {
  kind: 'ownership_name', title: 'Sale of the plant', description: 'The plant is sold to a new owner.',
  new_legal_entity: NEW_ENTITY, effective_on: '2026-12-01',
}

function changeRow(over: Record<string, unknown> = {}) {
  return {
    id: CHANGE, tenant_id: TENANT_A, facility_id: null, discipline: 'ems', kind: 'ownership_name', title: 'Sale of the plant',
    description: 'New owner.', process_area: null, new_legal_entity: NEW_ENTITY, effective_on: null, status: 'open',
    opened_at: '2026-10-01T00:00:00Z', ended_at: null, ...over,
  }
}
function impactRow(over: Record<string, unknown> = {}) {
  return {
    id: IMPACT, tenant_id: TENANT_A, change_id: CHANGE, target_type: 'permit', target_id: PERMIT_AIR, step: 'notify_agency',
    step_order: 1, action_required: 'Notify the agency.', resolved_at: null, resolved_by: null, resolution_note: null,
    created_at: '2026-10-01T00:00:00Z', ...over,
  }
}

beforeEach(() => {
  resetStore()
  seed('environmental_permits', [
    { id: PERMIT_AIR,   tenant_id: TENANT_A, facility_id: FACILITY_A, title: 'Paint booth permit by rule', agency: 'State air agency', holder_of_record: OLD_ENTITY, retired_at: null },
    { id: PERMIT_WATER, tenant_id: TENANT_A, facility_id: FACILITY_A, title: 'Wastewater discharge', agency: 'City of Northfield', holder_of_record: OLD_ENTITY, retired_at: null },
    { id: PERMIT_SITE_B, tenant_id: TENANT_A, facility_id: SITE_B, title: 'Second plant stormwater', agency: 'State water agency', holder_of_record: OLD_ENTITY, retired_at: null },
    { id: 'f0000000-0000-4000-8000-0000000000c9', tenant_id: TENANT_A, facility_id: FACILITY_A, title: 'Retired', agency: 'X', holder_of_record: OLD_ENTITY, retired_at: '2025-01-01T00:00:00Z' },
    { id: 'f0000000-0000-4000-8000-0000000000d9', tenant_id: TENANT_B, facility_id: null, title: 'Other tenant', agency: 'Y', holder_of_record: 'Z', retired_at: null },
  ])
  seed('ms_scope_statements', [{ id: 'scope-3', tenant_id: TENANT_A, discipline: 'ems', version: 3, legal_entity: OLD_ENTITY, effective_from: '2020-01-01' }])
  seed('ms_policies', [{ id: 'policy-2', tenant_id: TENANT_A, discipline: 'ems', version: 2, signed_at: '2020-01-01' }])
  onRpc('ms_open_change', args => {
    seed('ms_changes', [changeRow({ id: CHANGE, ...(args.p_change as object) })])
    return { data: CHANGE, error: null }
  })
})

describe('gating', () => {
  it('lets a member read changes, and refuses every write to one', async () => {
    seed('ms_changes', [changeRow()])
    asMemberA()
    expect((await changes.GET(jsonRequest('/x', 'GET'))).status).toBe(200)
    expect((await change.GET(jsonRequest('/x', 'GET'), idContext(CHANGE))).status).toBe(200)
    for (const call of [
      () => changes.POST(jsonRequest('/x', 'POST', ownershipChange)),
      () => change.PATCH(jsonRequest('/x', 'PATCH', { title: 'x' }), idContext(CHANGE)),
      () => resolve.POST(jsonRequest('/x', 'POST', {}), { params: Promise.resolve({ id: CHANGE, impactId: IMPACT }) }),
    ]) expect((await call()).status).toBe(403)
    expect(writes).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('passes gate failures through, including the module being off', async () => {
    gateRejects(401, 'Invalid session')
    expect((await changes.GET(jsonRequest('/x', 'GET'))).status).toBe(401)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'owner', moduleOn: false })
    expect((await changes.GET(jsonRequest('/x', 'GET'))).status).toBe(403)
  })
})

describe('POST /changes', () => {
  it('opens an ownership change with a three-step checklist for each active permit, plus the scope and policy', async () => {
    rollUp()
    const res = await changes.POST(jsonRequest('/x', 'POST', ownershipChange))
    expect(res.status).toBe(201)
    expect((await res.json()).impacts).toBe(11)   // 3 permits x 3 steps + scope + policy

    expect(rpcCalls).toHaveLength(1)
    const { p_change, p_impacts } = rpcCalls[0].args as { p_change: Record<string, unknown>; p_impacts: Record<string, unknown>[] }
    expect(p_change).toMatchObject({
      tenant_id: TENANT_A, facility_id: null, discipline: 'ems', kind: 'ownership_name', new_legal_entity: NEW_ENTITY,
      effective_on: '2026-12-01',
    })
    expect(p_impacts.map(i => `${i.target_type}:${i.target_id}${i.step ? `:${i.step}` : ''}`)).toEqual([
      // Permits in title order: Paint booth, Second plant, Wastewater.
      `permit:${PERMIT_AIR}:notify_agency`, `permit:${PERMIT_AIR}:submit_transfer`, `permit:${PERMIT_AIR}:confirm_holder`,
      `permit:${PERMIT_SITE_B}:notify_agency`, `permit:${PERMIT_SITE_B}:submit_transfer`, `permit:${PERMIT_SITE_B}:confirm_holder`,
      `permit:${PERMIT_WATER}:notify_agency`, `permit:${PERMIT_WATER}:submit_transfer`, `permit:${PERMIT_WATER}:confirm_holder`,
      'scope:scope-3', 'policy:policy-2',
    ])
    expect(p_impacts[2]).toMatchObject({ step_order: 3, action_required: expect.stringContaining(NEW_ENTITY) })
  })

  it('previews the impacts a change would create without opening it', async () => {
    rollUp()
    const res = await changes.POST(jsonRequest('/x?preview=true', 'POST', ownershipChange))
    expect(res.status).toBe(200)
    expect((await res.json()).preview).toEqual({ impacts: 11, byTarget: { permit: 9, scope: 1, policy: 1 } })
    expect(rpcCalls).toEqual([])
    expect(writes).toEqual([])
  })

  it('still validates, and still refuses a change of owner from one site, when previewing', async () => {
    expect((await changes.POST(jsonRequest('/x?preview=true', 'POST', ownershipChange))).status).toBe(400)
    rollUp()
    expect((await changes.POST(jsonRequest('/x?preview=true', 'POST', { ...ownershipChange, title: '' }))).status).toBe(400)
  })

  it('refuses a change of owner from one site, which would miss the other sites\' permits', async () => {
    const res = await changes.POST(jsonRequest('/x', 'POST', ownershipChange))   // admin A, at FACILITY_A
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/every site/)
    expect(rpcCalls).toEqual([])
  })

  it('works out an equipment change from the aspects in its process area, at the selected site', async () => {
    seed('environmental_aspects', [
      { id: 'a1', tenant_id: TENANT_A, aspect: 'VOC emissions', process_area: 'Paint Line', facility_id: FACILITY_A, obsolete_at: null },
      { id: 'a2', tenant_id: TENANT_A, aspect: 'Quench oil', process_area: 'Forge', facility_id: FACILITY_A, obsolete_at: null },
      { id: 'a3', tenant_id: TENANT_A, aspect: 'Retired booth', process_area: 'Paint Line', facility_id: FACILITY_A, obsolete_at: '2025-01-01T00:00:00Z' },
      { id: 'a4', tenant_id: TENANT_A, aspect: 'Other plant', process_area: 'Paint Line', facility_id: SITE_B, obsolete_at: null },
      { id: 'a5', tenant_id: TENANT_B, aspect: 'Not yours', process_area: 'Paint Line', facility_id: null, obsolete_at: null },
    ])
    const res = await changes.POST(jsonRequest('/x', 'POST', {
      kind: 'equipment', title: 'New paint booth', description: 'A second booth.', process_area: ' paint line ',
    }))
    expect(res.status).toBe(201)
    const { p_change, p_impacts } = rpcCalls[0].args as { p_change: Record<string, unknown>; p_impacts: { target_id: string }[] }
    expect(p_change).toMatchObject({ facility_id: FACILITY_A, process_area: 'paint line' })
    expect(p_impacts.map(i => i.target_id)).toEqual(['a1'])
  })

  it('adds the open air and waste obligations to a chemical change', async () => {
    seed('compliance_calendar_obligations', [
      { id: 'o1', tenant_id: TENANT_A, discipline: 'ems', category: 'air', status: 'open', title: 'Coating records', facility_id: FACILITY_A },
      { id: 'o2', tenant_id: TENANT_A, discipline: 'ems', category: 'stormwater', status: 'open', title: 'Quarterly visual', facility_id: FACILITY_A },
      { id: 'o3', tenant_id: TENANT_A, discipline: 'ohs', category: 'air', status: 'open', title: 'OH&S only', facility_id: null },
    ])
    await changes.POST(jsonRequest('/x', 'POST', { kind: 'chemical', title: 'New solvent', description: 'A new solvent.' }))
    const { p_impacts } = rpcCalls[0].args as { p_impacts: { target_type: string; target_id: string }[] }
    expect(p_impacts.map(i => `${i.target_type}:${i.target_id}`)).toEqual(['obligation:o1'])
  })

  it('opens a personnel change with no automatic impacts', async () => {
    const res = await changes.POST(jsonRequest('/x', 'POST', { kind: 'personnel', title: 'New EHS lead', description: 'Handover.' }))
    expect(res.status).toBe(201)
    expect((await res.json()).impacts).toBe(0)
    expect((rpcCalls[0].args as { p_impacts: unknown[] }).p_impacts).toEqual([])
  })

  it('answers every problem at once, with the column names, before reading anything', async () => {
    const res = await changes.POST(jsonRequest('/x', 'POST', { kind: 'equipment', title: '', description: ' ', discipline: 'ohs' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field))
      .toEqual(['title', 'description', 'process_area', 'discipline'])
    expect(rpcCalls).toEqual([])
  })

  it('says so when a record the change touches was removed while it opened', async () => {
    rollUp()
    onRpc('ms_open_change', () => ({ data: null, error: { code: '23503', message: 'Impact target is not a record of this organization.' } }))
    const res = await changes.POST(jsonRequest('/x', 'POST', ownershipChange))
    expect(res.status).toBe(409)
  })

  it('reads only the caller\'s tenant', async () => {
    rollUp()
    await changes.POST(jsonRequest('/x', 'POST', ownershipChange))
    const { p_impacts } = rpcCalls[0].args as { p_impacts: { target_id: string }[] }
    expect(p_impacts.some(i => i.target_id === 'f0000000-0000-4000-8000-0000000000d9')).toBe(false)
  })
})

describe('GET /changes', () => {
  beforeEach(() => {
    seed('ms_changes', [
      changeRow(),
      changeRow({ id: 'c0000000-0000-4000-8000-0000000000c2', status: 'closed', opened_at: '2026-08-01T00:00:00Z', ended_at: '2026-09-01T00:00:00Z' }),
      changeRow({ id: 'c0000000-0000-4000-8000-0000000000d1', discipline: 'ohs', opened_at: '2026-09-01T00:00:00Z' }),
      changeRow({ id: OTHER_TENANT_CHANGE, tenant_id: TENANT_B }),
    ])
    seed('ms_change_impacts', [
      impactRow({ id: 'i1' }), impactRow({ id: 'i2', resolved_at: '2026-10-02T00:00:00Z' }), impactRow({ id: 'i3', resolved_at: '2026-10-02T00:00:00Z' }),
    ])
  })

  it('lists open changes by default with their progress, newest first, environmental disciplines only', async () => {
    const body = await (await changes.GET(jsonRequest('/x', 'GET'))).json()
    expect(body.changes.map((c: { id: string }) => c.id)).toEqual([CHANGE])
    expect(body.changes[0]).toMatchObject({ impacts_total: 3, impacts_resolved: 2 })
  })

  it('filters by status, and refuses an unknown one', async () => {
    const ids = async (query: string) =>
      ((await (await changes.GET(jsonRequest(`/x${query}`, 'GET'))).json()).changes as { id: string }[]).map(c => c.id)
    expect(await ids('?status=closed')).toEqual(['c0000000-0000-4000-8000-0000000000c2'])
    expect(await ids('?status=all')).toEqual([CHANGE, 'c0000000-0000-4000-8000-0000000000c2'])
    expect((await changes.GET(jsonRequest('/x?status=lapsed', 'GET'))).status).toBe(400)
  })
})

describe('GET /changes/[id]', () => {
  beforeEach(() => {
    seed('ms_changes', [changeRow(), changeRow({ id: OTHER_TENANT_CHANGE, tenant_id: TENANT_B })])
    seed('ms_scope_statements', [{ id: 'scope-4', tenant_id: TENANT_A, discipline: 'ems', version: 4, legal_entity: NEW_ENTITY, effective_from: '2026-11-01' }])
    seed('ms_change_impacts', [
      impactRow({ id: 'step1', step: 'notify_agency', step_order: 1 }),
      impactRow({ id: 'step3', step: 'confirm_holder', step_order: 3 }),
      impactRow({ id: 'scope', target_type: 'scope', target_id: 'scope-3', step: null, step_order: 0 }),
      impactRow({ id: 'policy', target_type: 'policy', target_id: 'policy-2', step: null, step_order: 0 }),
      impactRow({ id: 'aspect', target_type: 'aspect', target_id: 'a1', step: null, step_order: 0 }),
      impactRow({ id: 'done', step: 'submit_transfer', step_order: 2, resolved_at: '2026-10-02T00:00:00Z' }),
    ])
    seed('environmental_aspects', [{ id: 'a1', tenant_id: TENANT_A, aspect: 'VOC emissions', process_area: 'Paint Line' }])
    seed('ms_evidence', [{ id: 'proof', tenant_id: TENANT_A, subject_type: 'ms_change_impact', subject_id: 'step1', superseded_by: null, uploaded_at: '2026-10-02' }])
  })

  it('describes each impact: its target, and what still blocks it, by the rules the database enforces', async () => {
    const body = await (await change.GET(jsonRequest('/x', 'GET'), idContext(CHANGE))).json()
    const impact = (id: string) => body.impacts.find((i: { id: string }) => i.id === id)

    expect(impact('step1')).toMatchObject({ target_label: 'Paint booth permit by rule (State air agency)', blockers: [] })
    // No evidence yet, and the permit still names the old holder.
    expect(impact('step3').blockers).toEqual([
      'Attach evidence for this step first.',
      'The permit still names another holder. Update its holder of record to the new legal entity first.',
    ])
    // The scope in force (version 4) names the new entity, so the scope impact is clear; the policy was signed before it.
    expect(impact('scope').blockers).toEqual([])
    expect(impact('policy').blockers).toEqual(['The policy in force was signed before the scope named the new legal entity. Have it signed again first.'])
    expect(impact('aspect')).toMatchObject({ needs_note: true, blockers: [], target_label: 'VOC emissions (Paint Line)' })
    expect(impact('done').blockers).toEqual([])
    expect(body.closeBlockers).toEqual(['5 impacts are not resolved yet.'])
    expect(body.evidence.map((e: { id: string }) => e.id)).toEqual(['proof'])
  })

  it('answers 404 for another tenant\'s change', async () => {
    expect((await change.GET(jsonRequest('/x', 'GET'), idContext(OTHER_TENANT_CHANGE))).status).toBe(404)
  })
})

describe('PATCH /changes/[id]', () => {
  beforeEach(() => {
    seed('ms_changes', [changeRow(), changeRow({ id: OTHER_TENANT_CHANGE, tenant_id: TENANT_B })])
    seed('ms_change_impacts', [impactRow({ id: 'i1', resolved_at: '2026-10-02T00:00:00Z' })])
  })
  const patch = (body: unknown, id = CHANGE) => change.PATCH(jsonRequest('/x', 'PATCH', body), idContext(id))

  it('corrects what a change says, and nothing it was worked out from', async () => {
    const res = await patch({ title: 'Sale of the Northfield plant', effective_on: '2026-12-15', kind: 'other', new_legal_entity: 'Someone Else' })
    expect(res.status).toBe(200)
    expect(rowsIn('ms_changes')[0]).toMatchObject({
      title: 'Sale of the Northfield plant', effective_on: '2026-12-15', kind: 'ownership_name', new_legal_entity: NEW_ENTITY,
    })
  })

  it('refuses to close a change of owner from one site, which would hide the other sites\' permits from the re-check', async () => {
    const res = await patch({ status: 'closed' })   // admin A, at FACILITY_A
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/every site/)
    expect(rowsIn('ms_changes')[0].status).toBe('open')
  })

  it('closes a change once every impact is resolved, and says what is left otherwise', async () => {
    rollUp()
    seed('ms_change_impacts', [impactRow({ id: 'i2' })])
    const refused = await patch({ status: 'closed' })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toBe('1 impact is not resolved yet.')
    expect(rowsIn('ms_changes')[0].status).toBe('open')

    rowsIn('ms_change_impacts')[1].resolved_at = '2026-10-02T00:00:00Z'
    expect((await patch({ status: 'closed' })).status).toBe(200)
    expect(rowsIn('ms_changes')[0].status).toBe('closed')
  })

  it('cancels with a reason, keeping the impacts', async () => {
    expect((await patch({ status: 'cancelled' })).status).toBe(400)
    expect((await patch({ status: 'cancelled', cancelled_reason: 'The sale fell through' })).status).toBe(200)
    expect(rowsIn('ms_changes')[0]).toMatchObject({ status: 'cancelled', cancelled_reason: 'The sale fell through' })
    expect(rowsIn('ms_change_impacts')).toHaveLength(1)
  })

  it('refuses to edit a change that has ended, and one that ends while it is being edited', async () => {
    rowsIn('ms_changes')[0].status = 'closed'
    expect((await patch({ title: 'x' })).status).toBe(409)
    rowsIn('ms_changes')[0].status = 'open'
    beforeNext('ms_changes', 'update', () => { rowsIn('ms_changes')[0].status = 'cancelled' })
    expect((await patch({ title: 'x' })).status).toBe(409)
  })

  it('keeps editing and ending separate, and refuses a status it does not know', async () => {
    expect((await patch({ title: 'x', status: 'closed' })).status).toBe(400)
    expect((await patch({ status: 'reopened' })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
  })

  it('answers 404 for another tenant\'s change, and never edits it', async () => {
    expect((await patch({ title: 'mine now' }, OTHER_TENANT_CHANGE)).status).toBe(404)
    expect(rowsIn('ms_changes').find(c => c.id === OTHER_TENANT_CHANGE)?.title).toBe('Sale of the plant')
    asAdminB()
    expect((await patch({ title: 'x' })).status).toBe(404)
  })
})

describe('POST /changes/[id]/impacts/[impactId]/resolve', () => {
  beforeEach(() => {
    seed('ms_changes', [changeRow()])
    seed('ms_change_impacts', [impactRow(), impactRow({ id: OTHER_TENANT_IMPACT, tenant_id: TENANT_B })])
  })
  const post = (body: unknown = {}, impactId = IMPACT) =>
    resolve.POST(jsonRequest('/x', 'POST', body), { params: Promise.resolve({ id: CHANGE, impactId }) })

  it('resolves an impact with a note', async () => {
    const res = await post({ resolution_note: 'Agency confirmed by letter.' })
    expect(res.status).toBe(200)
    expect(rowsIn('ms_change_impacts')[0]).toMatchObject({ resolution_note: 'Agency confirmed by letter.' })
    expect(rowsIn('ms_change_impacts')[0].resolved_at).toBeTruthy()
  })

  it('passes on the database\'s own reason when a rule refuses it', async () => {
    const reason = 'The permit still names another holder. Update its holder of record to the new legal entity first.'
    failNext('ms_change_impacts', { code: '23514', message: reason }, 'update')
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(reason)
  })

  it('says an impact is already resolved, and 404s for one that is not here', async () => {
    rowsIn('ms_change_impacts')[0].resolved_at = '2026-10-02T00:00:00Z'
    const again = await post()
    expect(again.status).toBe(409)
    expect((await again.json()).error).toMatch(/already resolved/)
    expect((await post({}, 'c1000000-0000-4000-8000-0000000000ff')).status).toBe(404)
    expect((await post({}, OTHER_TENANT_IMPACT)).status).toBe(404)
    expect((await post({}, 'not-an-id')).status).toBe(400)
  })

  it('caps the note', async () => {
    expect((await post({ resolution_note: 'x'.repeat(2001) })).status).toBe(400)
  })
})
