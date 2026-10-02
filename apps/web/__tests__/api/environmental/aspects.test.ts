// The aspects register (clause 6.1.2) behind /api/environmental/aspects.
// Aspects belong to a facility, are scored one operating condition at a
// time under the tenant's scoring method, retire instead of being deleted,
// and never cross tenants.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ADMIN_A, FACILITY_A, TENANT_A, TENANT_B,
  asAdminA, asAdminB, asMemberA, beforeNext, callAs, gateRejects, idContext, jsonRequest, resetStore, rowsIn, seed, writes,
} from './_emsHarness'

import * as aspects from '@/app/api/environmental/aspects/route'
import * as aspect from '@/app/api/environmental/aspects/[id]/route'
import * as scores from '@/app/api/environmental/aspects/[id]/scores/route'
import * as obsolete from '@/app/api/environmental/aspects/[id]/obsolete/route'
import * as review from '@/app/api/environmental/aspects/[id]/review/route'
import * as obligations from '@/app/api/environmental/aspects/[id]/obligations/route'

const ASPECT_A = 'a5000000-0000-4000-8000-00000000000a'
const ASPECT_B = 'a5000000-0000-4000-8000-00000000000b'
const METHOD_A = 'e0000000-0000-4000-8000-00000000000a'
const OBLIGATION_1 = 'b0000000-0000-4000-8000-000000000001'
const OBLIGATION_2 = 'b0000000-0000-4000-8000-000000000002'
const OBLIGATION_3 = 'b0000000-0000-4000-8000-000000000003'
const OBLIGATION_B = 'b0000000-0000-4000-8000-00000000000b'

function aspectRow(over: Record<string, unknown> = {}) {
  return {
    id: ASPECT_A, tenant_id: TENANT_A, facility_id: FACILITY_A,
    activity: 'Parts degreasing', aspect: 'Solvent vapour release', impact: 'Air pollution (VOC)',
    process_area: 'Finishing', life_cycle_stage: 'operation', flow: 'output', status: 'identified',
    controls: null, notes: null, source_reference: null, obsolete_at: null, obsolete_reason: null,
    last_reviewed_at: null, reviewed_by: null, next_review_due: '2027-06-01', ...over,
  }
}

const defaultMethod = {
  id: METHOD_A, tenant_id: TENANT_A, discipline: 'ems', name: 'Severity × likelihood (5×5)', version: 1,
  severity_levels: 5, likelihood_levels: 5, matrix: null, significance_threshold: 12, is_default: true, retired_at: null,
}

function scoreRow(over: Record<string, unknown>) {
  return {
    tenant_id: TENANT_A, aspect_id: ASPECT_A, method_id: METHOD_A, rationale: 'Assessed on the floor walk',
    operating_condition: 'normal', severity: 1, likelihood: 1, scored_at: '2026-09-01T00:00:00Z', ...over,
  }
}

const newAspect = {
  activity: 'Powder coating', aspect: 'Overspray to filters', impact: 'Solid waste', process_area: 'Finishing',
}

const scoreBody = { operating_condition: 'emergency', severity: 4, likelihood: 3, rationale: 'Bund failure reaches the drain' }

beforeEach(resetStore)

describe('gating', () => {
  const reads: [string, () => Promise<Response>][] = [
    ['GET aspects', () => aspects.GET(jsonRequest('/api/environmental/aspects', 'GET'))],
    ['GET aspect', () => aspect.GET(jsonRequest('/x', 'GET'), idContext(ASPECT_A))],
  ]
  const writeCalls: [string, () => Promise<Response>][] = [
    ['POST aspects', () => aspects.POST(jsonRequest('/x', 'POST', newAspect))],
    ['PATCH aspect', () => aspect.PATCH(jsonRequest('/x', 'PATCH', { notes: 'n' }), idContext(ASPECT_A))],
    ['POST score', () => scores.POST(jsonRequest('/x', 'POST', scoreBody), idContext(ASPECT_A))],
    ['POST obsolete', () => obsolete.POST(jsonRequest('/x', 'POST', { reason: 'Line removed' }), idContext(ASPECT_A))],
    ['POST review', () => review.POST(jsonRequest('/x', 'POST'), idContext(ASPECT_A))],
    ['PUT obligations', () => obligations.PUT(jsonRequest('/x', 'PUT', { obligation_ids: [] }), idContext(ASPECT_A))],
  ]

  beforeEach(() => seed('environmental_aspects', [aspectRow()]))

  it.each([...reads, ...writeCalls])('%s passes an authentication failure through', async (_name, call) => {
    gateRejects(401, 'Invalid session')
    expect((await call()).status).toBe(401)
  })

  it.each([...reads, ...writeCalls])('%s answers 403 when the module is off', async (_name, call) => {
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'owner', moduleOn: false })
    expect((await call()).status).toBe(403)
  })

  it.each(writeCalls)('%s refuses a member, and writes nothing', async (_name, call) => {
    asMemberA()
    expect((await call()).status).toBe(403)
    expect(writes).toEqual([])
  })

  it.each(reads)('%s lets a member read', async (_name, call) => {
    asMemberA()
    expect((await call()).status).toBe(200)
  })
})

describe('POST /aspects', () => {
  it('records the aspect at the active facility for the gate tenant', async () => {
    const res = await aspects.POST(jsonRequest('/x', 'POST', { ...newAspect, tenant_id: TENANT_B, facility_id: 'elsewhere' }))
    expect(res.status).toBe(201)
    expect((await res.json()).aspect).toMatchObject({
      tenant_id: TENANT_A, facility_id: FACILITY_A, process_area: 'Finishing',
      life_cycle_stage: 'operation', status: 'identified', created_by: ADMIN_A,
    })
  })

  it('asks for a facility when none is selected: an aspect belongs to a site', async () => {
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin', facilityId: null })
    const res = await aspects.POST(jsonRequest('/x', 'POST', newAspect))
    expect(res.status).toBe(400)
    expect(writes).toEqual([])
  })

  it('reports missing fields by column name', async () => {
    const res = await aspects.POST(jsonRequest('/x', 'POST', { activity: 'Welding' }))
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field)).toEqual(['aspect', 'impact', 'process_area'])
  })

  it('never stores a score sent with the aspect', async () => {
    await aspects.POST(jsonRequest('/x', 'POST', { ...newAspect, severity: 5, likelihood: 5, significant: true }))
    expect(writes[0].payload).not.toHaveProperty('severity')
    expect(writes[0].payload).not.toHaveProperty('significant')
  })
})

describe('GET /aspects', () => {
  beforeEach(() => {
    seed('ms_scoring_methods', [defaultMethod])
    seed('environmental_aspects', [
      aspectRow(),
      aspectRow({ id: 'a2', process_area: 'Utilities', activity: 'Boiler', next_review_due: '2020-01-01' }),
      aspectRow({ id: 'a3', obsolete_at: '2026-01-01T00:00:00Z', obsolete_reason: 'Line removed' }),
      aspectRow({ id: ASPECT_B, tenant_id: TENANT_B }),
    ])
    seed('environmental_aspect_scores', [
      scoreRow({ id: 's1', severity: 4, likelihood: 3 }),                       // 12: significant
      scoreRow({ id: 's2', aspect_id: 'a2', severity: 2, likelihood: 2 }),     // 4
    ])
  })

  const list = async (query = '') => {
    const res = await aspects.GET(jsonRequest(`/api/environmental/aspects${query}`, 'GET'))
    return { status: res.status, body: await res.json() }
  }
  const ids = async (query = '') => (await list(query)).body.aspects.map((a: { id: string }) => a.id)

  it('lists the tenant\'s active aspects with their current scores', async () => {
    const { body } = await list()
    expect(body.aspects.map((a: { id: string }) => a.id)).toEqual([ASPECT_A, 'a2'])
    expect(body.aspects[0]).toMatchObject({ significant: true, max_score: 12 })
    expect(body.aspects[0].current_scores).toEqual([expect.objectContaining({ operating_condition: 'normal', score: 12 })])
    expect(body.nextOffset).toBeNull()
  })

  it('filters by status, significance, process area and overdue review', async () => {
    expect(await ids('?status=obsolete')).toEqual(['a3'])
    expect(await ids('?significant=true')).toEqual([ASPECT_A])
    expect(await ids('?significant=false')).toEqual(['a2'])
    expect(await ids('?process_area=Utilities')).toEqual(['a2'])
    expect(await ids('?review_due=overdue')).toEqual(['a2'])
  })

  it('never shows another tenant\'s aspects', async () => {
    asAdminB()
    expect(await ids('?status=all')).toEqual([ASPECT_B])
  })

  it('pages 200 at a time', async () => {
    seed('environmental_aspects', Array.from({ length: 199 }, (_, i) =>
      aspectRow({ id: `p${String(i).padStart(3, '0')}`, process_area: 'Warehouse' })))
    const first = await list()
    expect(first.body.aspects).toHaveLength(200)
    expect(first.body.nextOffset).toBe(200)
    const second = await list('?offset=200')
    expect(second.body.aspects).toHaveLength(1)
    expect(second.body.nextOffset).toBeNull()
  })

  it.each(['?status=deleted', '?significant=yes', '?review_due=soon', '?offset=-1', '?offset=1.5'])(
    'refuses %s', async query => {
      expect((await list(query)).status).toBe(400)
    })
})

describe('GET and PATCH /aspects/[id]', () => {
  beforeEach(() => {
    seed('ms_scoring_methods', [defaultMethod])
    seed('environmental_aspects', [aspectRow(), aspectRow({ id: ASPECT_B, tenant_id: TENANT_B })])
    seed('environmental_aspect_scores', [
      scoreRow({ id: 's1', severity: 1, likelihood: 2, scored_at: '2026-08-01T00:00:00Z' }),
      scoreRow({ id: 's2', severity: 4, likelihood: 4, scored_at: '2026-09-01T00:00:00Z' }),
      scoreRow({ id: 's3', operating_condition: 'emergency', severity: 3, likelihood: 3 }),
    ])
    seed('environmental_aspect_obligations', [{ tenant_id: TENANT_A, aspect_id: ASPECT_A, obligation_id: OBLIGATION_1 }])
  })

  it('returns the aspect, its full score history newest first, and its linked obligations', async () => {
    const body = await (await aspect.GET(jsonRequest('/x', 'GET'), idContext(ASPECT_A))).json()
    expect(body.aspect.current_scores.map((c: { operating_condition: string; score: number }) =>
      [c.operating_condition, c.score])).toEqual([['normal', 16], ['emergency', 9]])
    expect(body.history.map((h: { id: string }) => h.id)).toEqual(['s3', 's2', 's1'])
    expect(body.obligationIds).toEqual([OBLIGATION_1])
  })

  it('answers 404 for another tenant\'s aspect', async () => {
    expect((await aspect.GET(jsonRequest('/x', 'GET'), idContext(ASPECT_B))).status).toBe(404)
    expect((await aspect.PATCH(jsonRequest('/x', 'PATCH', { notes: 'x' }), idContext(ASPECT_B))).status).toBe(404)
    expect(rowsIn('environmental_aspects').find(a => a.id === ASPECT_B)).toMatchObject({ notes: null })
  })

  it('edits only the description fields sent', async () => {
    const res = await aspect.PATCH(jsonRequest('/x', 'PATCH', { controls: 'Lid kept closed', severity: 5 }), idContext(ASPECT_A))
    expect(res.status).toBe(200)
    expect(writes.at(-1)?.payload).toEqual({ updated_by: ADMIN_A, controls: 'Lid kept closed' })
  })

  it('refuses an edit that changes no editable field, such as a score', async () => {
    const res = await aspect.PATCH(jsonRequest('/x', 'PATCH', { severity: 5, likelihood: 5 }), idContext(ASPECT_A))
    expect(res.status).toBe(400)
    expect(writes).toEqual([])
  })

  it('validates the stored aspect and the edit together', async () => {
    const res = await aspect.PATCH(jsonRequest('/x', 'PATCH', { process_area: '' }), idContext(ASPECT_A))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'process_area', message: 'is required' }])
  })
})

describe('POST /aspects/[id]/scores', () => {
  beforeEach(() => seed('environmental_aspects', [aspectRow(), aspectRow({ id: ASPECT_B, tenant_id: TENANT_B })]))

  it('creates the default method on a tenant\'s first score, and answers with the computed score', async () => {
    const res = await scores.POST(jsonRequest('/x', 'POST', scoreBody), idContext(ASPECT_A))
    expect(res.status).toBe(201)
    expect((await res.json()).score).toMatchObject({
      operating_condition: 'emergency', severity: 4, likelihood: 3, score: 12, significant: true,
      scored_by: ADMIN_A, tenant_id: TENANT_A,
    })
    expect(rowsIn('ms_scoring_methods')).toEqual([expect.objectContaining({
      tenant_id: TENANT_A, is_default: true, severity_levels: 5, likelihood_levels: 5, significance_threshold: 12, matrix: null,
    })])
  })

  it('scores under the existing default method instead of making another', async () => {
    seed('ms_scoring_methods', [{ ...defaultMethod, significance_threshold: 15, version: 2 }])
    const body = await (await scores.POST(jsonRequest('/x', 'POST', scoreBody), idContext(ASPECT_A))).json()
    expect(body.score).toMatchObject({ method_id: METHOD_A, score: 12, significant: false, significance_threshold: 15 })
    expect(rowsIn('ms_scoring_methods')).toHaveLength(1)
  })

  it('takes the winner\'s method when two first scores race to create it', async () => {
    beforeNext('ms_scoring_methods', 'insert', () => seed('ms_scoring_methods', [defaultMethod]))
    const res = await scores.POST(jsonRequest('/x', 'POST', scoreBody), idContext(ASPECT_A))
    expect(res.status).toBe(201)
    expect((await res.json()).score.method_id).toBe(METHOD_A)
    expect(rowsIn('ms_scoring_methods')).toHaveLength(1)
  })

  it('ignores a score the client computed', async () => {
    await scores.POST(jsonRequest('/x', 'POST', { ...scoreBody, score: 25, significant: true }), idContext(ASPECT_A))
    expect(writes.find(w => w.table === 'environmental_aspect_scores')?.payload).not.toHaveProperty('score')
  })

  it('checks the score against the method\'s scale and asks why', async () => {
    const res = await scores.POST(jsonRequest('/x', 'POST', {
      operating_condition: 'storm', severity: 6, likelihood: '3', rationale: ' ',
    }), idContext(ASPECT_A))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field))
      .toEqual(['operating_condition', 'severity', 'likelihood', 'rationale'])
    expect(rowsIn('environmental_aspect_scores')).toEqual([])
  })

  it('answers 404 for another tenant\'s aspect and 409 for an obsolete one', async () => {
    expect((await scores.POST(jsonRequest('/x', 'POST', scoreBody), idContext(ASPECT_B))).status).toBe(404)
    const obsoleteId = 'a5000000-0000-4000-8000-0000000000ff'
    seed('environmental_aspects', [aspectRow({ id: obsoleteId, obsolete_at: '2026-01-01T00:00:00Z', obsolete_reason: 'Removed' })])
    expect((await scores.POST(jsonRequest('/x', 'POST', scoreBody), idContext(obsoleteId))).status).toBe(409)
    expect(rowsIn('environmental_aspect_scores')).toEqual([])
  })
})

describe('POST /aspects/[id]/obsolete and /review', () => {
  beforeEach(() => seed('environmental_aspects', [aspectRow(), aspectRow({ id: ASPECT_B, tenant_id: TENANT_B })]))

  it('retires an aspect once, with a reason', async () => {
    expect((await obsolete.POST(jsonRequest('/x', 'POST', { reason: ' ' }), idContext(ASPECT_A))).status).toBe(400)

    const res = await obsolete.POST(jsonRequest('/x', 'POST', { reason: 'Degreasing line removed' }), idContext(ASPECT_A))
    expect(res.status).toBe(200)
    expect(rowsIn('environmental_aspects')[0]).toMatchObject({
      obsolete_reason: 'Degreasing line removed', obsolete_at: expect.any(String), updated_by: ADMIN_A,
    })

    const again = await obsolete.POST(jsonRequest('/x', 'POST', { reason: 'Again' }), idContext(ASPECT_A))
    expect(again.status).toBe(409)
    expect(rowsIn('environmental_aspects')[0]).toMatchObject({ obsolete_reason: 'Degreasing line removed' })
  })

  it('answers 404 for another tenant\'s aspect, and changes nothing', async () => {
    expect((await obsolete.POST(jsonRequest('/x', 'POST', { reason: 'x' }), idContext(ASPECT_B))).status).toBe(404)
    expect((await review.POST(jsonRequest('/x', 'POST'), idContext(ASPECT_B))).status).toBe(404)
    expect(rowsIn('environmental_aspects').find(a => a.id === ASPECT_B)).toMatchObject({ obsolete_at: null, reviewed_by: null })
  })

  it('records a review', async () => {
    asAdminA()
    expect((await review.POST(jsonRequest('/x', 'POST'), idContext(ASPECT_A))).status).toBe(200)
    expect(rowsIn('environmental_aspects')[0]).toMatchObject({ reviewed_by: ADMIN_A, last_reviewed_at: expect.any(String) })
  })
})

describe('PUT /aspects/[id]/obligations', () => {
  beforeEach(() => {
    seed('environmental_aspects', [aspectRow(), aspectRow({ id: ASPECT_B, tenant_id: TENANT_B })])
    seed('compliance_calendar_obligations', [OBLIGATION_1, OBLIGATION_2, OBLIGATION_3].map(id => ({ id, tenant_id: TENANT_A }))
      .concat([{ id: OBLIGATION_B, tenant_id: TENANT_B }]))
    seed('environmental_aspect_obligations', [
      { tenant_id: TENANT_A, aspect_id: ASPECT_A, obligation_id: OBLIGATION_1 },
      { tenant_id: TENANT_A, aspect_id: ASPECT_A, obligation_id: OBLIGATION_2 },
    ])
  })

  const linked = () => rowsIn('environmental_aspect_obligations')
    .filter(l => l.aspect_id === ASPECT_A).map(l => l.obligation_id).sort()

  it('replaces the linked set, adding before removing', async () => {
    const res = await obligations.PUT(
      jsonRequest('/x', 'PUT', { obligation_ids: [OBLIGATION_3, OBLIGATION_2, OBLIGATION_3] }), idContext(ASPECT_A))
    expect(res.status).toBe(200)
    expect((await res.json()).obligationIds).toEqual([OBLIGATION_2, OBLIGATION_3])
    expect(linked()).toEqual([OBLIGATION_2, OBLIGATION_3])
    expect(writes.map(w => w.mode)).toEqual(['insert', 'delete'])
  })

  it('refuses another tenant\'s obligation and leaves the links as they were', async () => {
    const res = await obligations.PUT(
      jsonRequest('/x', 'PUT', { obligation_ids: [OBLIGATION_3, OBLIGATION_B] }), idContext(ASPECT_A))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([
      { field: 'obligation_ids', message: 'includes an obligation that is not in this organization' },
    ])
    expect(linked()).toEqual([OBLIGATION_1, OBLIGATION_2])
  })

  it.each([{}, { obligation_ids: 'all' }, { obligation_ids: ['nope'] }])('refuses %j', async body => {
    expect((await obligations.PUT(jsonRequest('/x', 'PUT', body), idContext(ASPECT_A))).status).toBe(400)
  })

  it('answers 404 for another tenant\'s aspect', async () => {
    const res = await obligations.PUT(jsonRequest('/x', 'PUT', { obligation_ids: [] }), idContext(ASPECT_B))
    expect(res.status).toBe(404)
  })
})
