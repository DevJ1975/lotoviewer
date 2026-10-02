// The compliance obligations register (clause 6.1.3) behind
// /api/environmental/obligations: the compliance calendar seen as a legal
// register, limited to environmental and integrated rows, never crossing
// tenants.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ADMIN_A, FACILITY_A, TENANT_A, TENANT_B,
  asAdminB, asMemberA, callAs, gateRejects, idContext, jsonRequest, resetStore, rowsIn, seed, writes,
} from './_emsHarness'

import * as obligations from '@/app/api/environmental/obligations/route'
import * as obligation from '@/app/api/environmental/obligations/[id]/route'
import * as review from '@/app/api/environmental/obligations/[id]/review/route'

const OB_A = 'b0000000-0000-4000-8000-00000000000a'
const OB_OHS = 'b0000000-0000-4000-8000-0000000000c5'
const OB_B = 'b0000000-0000-4000-8000-00000000000b'

function obligationRow(over: Record<string, unknown> = {}) {
  return {
    id: OB_A, tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'ems', title: 'Stormwater permit DMRs',
    description: null, regulatory_ref: 'TPDES MSGP', category: 'general', cadence: 'quarterly', cadence_days: null,
    next_due_at: '2026-10-28', status: 'open', source: 'tenant', system_key: null, source_kind: 'permit',
    jurisdiction: 'state:TX', applicability_rationale: 'Industrial stormwater discharge', evaluation_cadence_days: 365,
    last_reviewed_at: null, reviewed_by: null, next_review_due: '2027-06-01', ...over,
  }
}

const newObligation = {
  title: 'Tier II chemical inventory report', source_kind: 'law', regulatory_ref: 'EPCRA §312',
  jurisdiction: 'federal', applicability_rationale: 'Sulfuric acid above the reporting threshold',
  evaluation_cadence_days: 365, next_due_at: '2027-03-01', cadence: 'annual',
}

beforeEach(resetStore)

describe('gating', () => {
  const reads: [string, () => Promise<Response>][] = [
    ['GET obligations', () => obligations.GET(jsonRequest('/api/environmental/obligations', 'GET'))],
    ['GET obligation', () => obligation.GET(jsonRequest('/x', 'GET'), idContext(OB_A))],
  ]
  const writeCalls: [string, () => Promise<Response>][] = [
    ['POST obligations', () => obligations.POST(jsonRequest('/x', 'POST', newObligation))],
    ['PATCH obligation', () => obligation.PATCH(jsonRequest('/x', 'PATCH', { title: 't' }), idContext(OB_A))],
    ['POST review', () => review.POST(jsonRequest('/x', 'POST'), idContext(OB_A))],
  ]

  beforeEach(() => seed('compliance_calendar_obligations', [obligationRow()]))

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

describe('POST /obligations', () => {
  it('adds an environmental obligation to the calendar for the gate tenant and facility', async () => {
    const res = await obligations.POST(jsonRequest('/x', 'POST', { ...newObligation, tenant_id: TENANT_B }))
    expect(res.status).toBe(201)
    expect((await res.json()).obligation).toMatchObject({
      tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'ems', source: 'tenant', created_by: ADMIN_A,
      regulatory_ref: 'EPCRA §312', jurisdiction: 'federal', evaluation_cadence_days: 365,
      next_due_at: '2027-03-01', cadence: 'annual', cadence_days: null,
    })
  })

  it('reports register and deadline problems together, by column name', async () => {
    const res = await obligations.POST(jsonRequest('/x', 'POST', {
      title: '', source_kind: 'rumour', regulatory_ref: 'x'.repeat(301), jurisdiction: 'state:tx',
      evaluation_cadence_days: '365', cadence: 'custom_days',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field)).toEqual([
      'title', 'source_kind', 'regulatory_ref', 'jurisdiction', 'evaluation_cadence_days', 'next_due_at', 'cadence_days',
    ])
    expect(writes).toEqual([])
  })

  it('accepts an obligation the nightly job never schedules', async () => {
    const res = await obligations.POST(jsonRequest('/x', 'POST', { ...newObligation, evaluation_cadence_days: null }))
    expect((await res.json()).obligation.evaluation_cadence_days).toBeNull()
  })

  it('refuses a custom deadline cadence too large to store, by name, instead of failing as a 500', async () => {
    const res = await obligations.POST(jsonRequest('/x', 'POST', { ...newObligation, cadence: 'custom_days', cadence_days: 1e10 }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([expect.objectContaining({ field: 'cadence_days' })])
  })

  it('refuses an OH&S-only obligation: that register is Phase 8\'s', async () => {
    const res = await obligations.POST(jsonRequest('/x', 'POST', { ...newObligation, discipline: 'ohs' }))
    expect((await res.json()).fieldErrors).toEqual([{ field: 'discipline', message: 'must be ems or integrated' }])
  })
})

describe('GET /obligations', () => {
  beforeEach(() => {
    seed('compliance_calendar_obligations', [
      obligationRow(),
      obligationRow({ id: 'o-int', discipline: 'integrated', title: 'Air permit', next_review_due: '2020-01-01' }),
      obligationRow({ id: 'o-gone', title: 'Old permit', status: 'dismissed' }),
      obligationRow({ id: OB_OHS, discipline: 'ohs', title: 'OSHA 300A posting' }),
      obligationRow({ id: OB_B, tenant_id: TENANT_B, title: 'Someone else\'s permit' }),
    ])
    seed('ms_compliance_evaluations', [
      { id: 'e1', tenant_id: TENANT_A, obligation_id: OB_A, completed_at: '2026-06-01T00:00:00Z', result: 'compliant' },
      { id: 'e2', tenant_id: TENANT_A, obligation_id: OB_A, completed_at: '2026-09-01T00:00:00Z', result: 'noncompliant', nonconformity_id: 'nc1' },
      { id: 'e3', tenant_id: TENANT_A, obligation_id: OB_A, completed_at: null, scheduled_for: '2026-10-15', assigned_to: ADMIN_A },
    ])
  })

  const ids = async (query = '') => {
    const res = await obligations.GET(jsonRequest(`/api/environmental/obligations${query}`, 'GET'))
    return (await res.json()).obligations.map((o: { id: string }) => o.id)
  }

  it('lists the tenant\'s environmental and integrated obligations with their latest result', async () => {
    const res = await obligations.GET(jsonRequest('/api/environmental/obligations', 'GET'))
    const body = await res.json()
    expect(body.obligations.map((o: { id: string }) => o.id)).toEqual(['o-int', OB_A])
    expect(body.obligations[1]).toMatchObject({
      last_evaluation_id: 'e2', last_result: 'noncompliant', last_nonconformity_id: 'nc1',
      open_evaluation_id: 'e3', open_evaluation_due: '2026-10-15',
    })
    expect(body.nextOffset).toBeNull()
  })

  it('filters by status, last result and overdue review', async () => {
    expect(await ids('?status=dismissed')).toEqual(['o-gone'])
    expect(await ids('?last_result=noncompliant')).toEqual([OB_A])
    expect(await ids('?last_result=none')).toEqual(['o-int'])
    expect(await ids('?review_due=overdue')).toEqual(['o-int'])
  })

  it('never shows another tenant\'s obligations', async () => {
    asAdminB()
    expect(await ids('?status=all')).toEqual([OB_B])
  })

  it.each(['?status=open', '?last_result=bad', '?review_due=later', '?offset=x', '?offset=1e30'])('refuses %s', async query => {
    expect((await obligations.GET(jsonRequest(`/api/environmental/obligations${query}`, 'GET'))).status).toBe(400)
  })
})

describe('GET, PATCH and review /obligations/[id]', () => {
  beforeEach(() => {
    seed('compliance_calendar_obligations', [
      obligationRow(),
      obligationRow({ id: OB_OHS, discipline: 'ohs' }),
      obligationRow({ id: OB_B, tenant_id: TENANT_B }),
    ])
    seed('ms_compliance_evaluations', [
      { id: 'e1', tenant_id: TENANT_A, obligation_id: OB_A, created_at: '2026-06-01T00:00:00Z', completed_at: '2026-06-02T00:00:00Z', result: 'compliant' },
      { id: 'e2', tenant_id: TENANT_A, obligation_id: OB_A, created_at: '2026-09-01T00:00:00Z', completed_at: null },
    ])
    seed('ms_evidence', [
      { id: 'ev1', tenant_id: TENANT_A, subject_type: 'compliance_evaluation', subject_id: 'e1', uploaded_at: '2026-06-02T00:00:00Z', storage_path: `${TENANT_A}/x.pdf` },
      { id: 'ev-other', tenant_id: TENANT_A, subject_type: 'compliance_evaluation', subject_id: 'unrelated', uploaded_at: '2026-06-02T00:00:00Z' },
    ])
  })

  it('returns the obligation, its evaluations newest first, and their evidence without storage paths', async () => {
    seed('environmental_aspects', [
      { id: 'asp1', tenant_id: TENANT_A, activity: 'Stormwater runoff', aspect: 'Sediment', obsolete_at: null },
      { id: 'asp2', tenant_id: TENANT_A, activity: 'Parts washing', aspect: 'Solvent', obsolete_at: null },
    ])
    seed('environmental_aspect_obligations', [{ tenant_id: TENANT_A, aspect_id: 'asp1', obligation_id: OB_A }])
    const body = await (await obligation.GET(jsonRequest('/x', 'GET'), idContext(OB_A))).json()
    expect(body.linkedAspects).toEqual([{ id: 'asp1', activity: 'Stormwater runoff', aspect: 'Sediment', obsolete_at: null }])
    expect(body.obligation).toMatchObject({ id: OB_A, last_result: 'compliant', open_evaluation_id: 'e2' })
    expect(body.evaluations.map((e: { id: string }) => e.id)).toEqual(['e2', 'e1'])
    expect(body.evidence.map((e: { id: string }) => e.id)).toEqual(['ev1'])
    expect(body.evidence[0]).not.toHaveProperty('storage_path')
  })

  it('answers 404 for an OH&S-only obligation and for another tenant\'s', async () => {
    for (const id of [OB_OHS, OB_B]) {
      expect((await obligation.GET(jsonRequest('/x', 'GET'), idContext(id))).status).toBe(404)
      expect((await obligation.PATCH(jsonRequest('/x', 'PATCH', { title: 'Mine now' }), idContext(id))).status).toBe(404)
    }
    expect(rowsIn('compliance_calendar_obligations').filter(o => o.title === 'Mine now')).toEqual([])
  })

  it('edits only the register fields sent, leaving the deadline to the calendar', async () => {
    const res = await obligation.PATCH(jsonRequest('/x', 'PATCH', {
      evaluation_cadence_days: 180, next_due_at: '2030-01-01', tenant_id: TENANT_B,
    }), idContext(OB_A))
    expect(res.status).toBe(200)
    expect(writes.at(-1)?.payload).toEqual({ evaluation_cadence_days: 180 })
  })

  it('names the citation by its column when it is too long', async () => {
    const res = await obligation.PATCH(jsonRequest('/x', 'PATCH', { regulatory_ref: 'x'.repeat(301) }), idContext(OB_A))
    expect((await res.json()).fieldErrors).toEqual([{ field: 'regulatory_ref', message: 'must be at most 300 characters' }])
  })

  it('refuses an edit with nothing to change', async () => {
    expect((await obligation.PATCH(jsonRequest('/x', 'PATCH', { next_due_at: '2030-01-01' }), idContext(OB_A))).status).toBe(400)
  })

  it('records a review for the gate tenant only', async () => {
    expect((await review.POST(jsonRequest('/x', 'POST'), idContext(OB_A))).status).toBe(200)
    expect(rowsIn('compliance_calendar_obligations').find(o => o.id === OB_A)).toMatchObject({ reviewed_by: ADMIN_A })
    expect((await review.POST(jsonRequest('/x', 'POST'), idContext(OB_B))).status).toBe(404)
  })
})

describe('PATCH /obligations/[id]: the permit a condition belongs to (Phase 2)', () => {
  const PERMIT = 'f0000000-0000-4000-8000-00000000000a'
  const patch = (body: unknown) => obligation.PATCH(jsonRequest('/x', 'PATCH', body), idContext(OB_A))

  beforeEach(() => {
    seed('compliance_calendar_obligations', [obligationRow({ permit_id: null })])
    seed('environmental_permits', [
      { id: PERMIT, tenant_id: TENANT_A, retired_at: null },
      { id: 'f0000000-0000-4000-8000-0000000000b0', tenant_id: TENANT_B, retired_at: null },
      { id: 'f0000000-0000-4000-8000-0000000000a9', tenant_id: TENANT_A, retired_at: '2026-01-01T00:00:00Z' },
    ])
  })

  it('links a permit obligation to its permit, and unlinks it', async () => {
    expect((await patch({ permit_id: PERMIT })).status).toBe(200)
    expect(rowsIn('compliance_calendar_obligations')[0].permit_id).toBe(PERMIT)
    expect((await patch({ permit_id: null })).status).toBe(200)
    expect(rowsIn('compliance_calendar_obligations')[0].permit_id).toBeNull()
  })

  it('refuses another tenant\'s permit, a retired one, and a malformed id', async () => {
    expect((await patch({ permit_id: 'f0000000-0000-4000-8000-0000000000b0' })).status).toBe(400)
    expect((await patch({ permit_id: 'f0000000-0000-4000-8000-0000000000a9' })).status).toBe(409)
    expect((await patch({ permit_id: 'permit-7' })).status).toBe(400)
    expect(rowsIn('compliance_calendar_obligations')[0].permit_id).toBeNull()
  })

  it('links only an obligation whose source is a permit, and keeps a linked one a permit obligation', async () => {
    rowsIn('compliance_calendar_obligations')[0].source_kind = 'law'
    const refused = await patch({ permit_id: PERMIT })
    expect(refused.status).toBe(400)
    expect((await refused.json()).fieldErrors[0].field).toBe('permit_id')

    Object.assign(rowsIn('compliance_calendar_obligations')[0], { source_kind: 'permit', permit_id: PERMIT })
    const changing = await patch({ source_kind: 'law' })
    expect(changing.status).toBe(400)
    expect((await changing.json()).fieldErrors[0].field).toBe('source_kind')
  })
})
