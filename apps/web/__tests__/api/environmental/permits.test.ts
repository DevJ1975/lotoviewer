// The permit vault behind /api/environmental/permits (Phase 2): permits held to a site,
// described by the core rules (standing, renewal countdown, holder-of-record check),
// renewed and retired rather than deleted, with conditions that are obligations.
// Every read and write stays inside the caller's tenant.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ADMIN_A, FACILITY_A, MEMBER_A, TENANT_A, TENANT_B,
  asAdminB, asMemberA, beforeNext, callAs, gateRejects, idContext, jsonRequest, resetStore, rowsIn, seed, writes,
} from './_emsHarness'

import * as permits from '@/app/api/environmental/permits/route'
import * as permit from '@/app/api/environmental/permits/[id]/route'
import * as renewal from '@/app/api/environmental/permits/[id]/renewal/route'
import * as retire from '@/app/api/environmental/permits/[id]/retire/route'
import * as review from '@/app/api/environmental/permits/[id]/review/route'
import * as conditions from '@/app/api/environmental/permits/[id]/conditions/route'

const TODAY = '2026-10-02'
const PERMIT_A = 'f0000000-0000-4000-8000-00000000000a'
const PERMIT_B = 'f0000000-0000-4000-8000-00000000000b'
const NEW_ENTITY = 'Northfield Forge & Finish LLC'
const OLD_ENTITY = 'Northfield Metal Products Inc.'

function permitRow(over: Record<string, unknown> = {}) {
  return {
    id: PERMIT_A, tenant_id: TENANT_A, facility_id: FACILITY_A, program: 'wastewater', instrument: 'permit',
    title: 'Industrial wastewater discharge permit', agency: 'City of Northfield', permit_number: 'DEMO-IWD-0001',
    jurisdiction: 'local:Northfield', holder_of_record: NEW_ENTITY, issued_on: '2022-01-01', expires_on: '2027-01-01',
    renewal_application_due_on: '2026-10-31', renewal_submitted_on: null, business_critical: true, owner_user_id: null,
    notes: null, retired_at: null, retired_reason: null, last_reviewed_at: null, reviewed_by: null,
    next_review_due: '2027-06-01', ...over,
  }
}

const newPermit = {
  program: 'air', instrument: 'registration', title: 'Paint booth permit by rule', agency: 'State air agency',
  permit_number: 'DEMO-PBR-0042', jurisdiction: 'state:TX', holder_of_record: NEW_ENTITY,
  issued_on: '2024-03-01', expires_on: null, business_critical: false,
}

beforeEach(() => {
  resetStore()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  seed('ms_scope_statements', [
    { tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: OLD_ENTITY },
    { tenant_id: TENANT_A, discipline: 'ems', version: 2, legal_entity: NEW_ENTITY },
  ])
  seed('tenant_memberships', [
    { user_id: ADMIN_A, tenant_id: TENANT_A, role: 'admin', invite_cancelled_at: null },
    { user_id: MEMBER_A, tenant_id: TENANT_A, role: 'member', invite_cancelled_at: null },
  ])
})
afterEach(() => vi.useRealTimers())

describe('gating', () => {
  beforeEach(() => seed('environmental_permits', [permitRow()]))

  it('lets a member read the vault and a permit', async () => {
    asMemberA()
    expect((await permits.GET(jsonRequest('/api/environmental/permits', 'GET'))).status).toBe(200)
    expect((await permit.GET(jsonRequest('/x', 'GET'), idContext(PERMIT_A))).status).toBe(200)
  })

  it.each([
    ['POST permits', () => permits.POST(jsonRequest('/x', 'POST', newPermit))],
    ['PATCH permit', () => permit.PATCH(jsonRequest('/x', 'PATCH', { notes: 'x' }), idContext(PERMIT_A))],
    ['POST renewal', () => renewal.POST(jsonRequest('/x', 'POST', { action: 'submitted', submitted_on: TODAY }), idContext(PERMIT_A))],
    ['POST retire', () => retire.POST(jsonRequest('/x', 'POST', { retired_reason: 'x' }), idContext(PERMIT_A))],
    ['POST review', () => review.POST(jsonRequest('/x', 'POST'), idContext(PERMIT_A))],
    ['POST condition', () => conditions.POST(jsonRequest('/x', 'POST', { title: 'x', next_due_at: TODAY }), idContext(PERMIT_A))],
  ])('refuses a member: %s', async (_name, call) => {
    asMemberA()
    expect((await call()).status).toBe(403)
    expect(writes).toEqual([])
  })

  it('passes gate failures through, including the module being off', async () => {
    gateRejects(401, 'Invalid session')
    expect((await permits.GET(jsonRequest('/x', 'GET'))).status).toBe(401)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'owner', moduleOn: false })
    expect((await permits.GET(jsonRequest('/x', 'GET'))).status).toBe(403)
  })
})

describe('GET /permits', () => {
  it('describes each permit by the core rules: standing, countdown, holder check, conditions', async () => {
    seed('environmental_permits', [
      permitRow(),
      permitRow({ id: 'f0000000-0000-4000-8000-0000000000a2', permit_number: 'DEMO-SW-1', program: 'stormwater',
        holder_of_record: OLD_ENTITY, expires_on: null, renewal_application_due_on: null, business_critical: false }),
    ])
    seed('compliance_calendar_obligations', [
      { tenant_id: TENANT_A, permit_id: PERMIT_A, status: 'open', next_due_at: '2026-09-30' },
      { tenant_id: TENANT_A, permit_id: PERMIT_A, status: 'open', next_due_at: '2026-12-31' },
      { tenant_id: TENANT_A, permit_id: PERMIT_A, status: 'completed', next_due_at: '2026-01-01' },
    ])
    const body = await (await permits.GET(jsonRequest('/api/environmental/permits', 'GET'))).json()
    expect(body.legalEntityInForce).toBe(NEW_ENTITY)
    const [discharge, stormwater] = body.permits
    expect(discharge).toMatchObject({
      standing: 'renewal_due', renewal_deadline: '2026-10-31', escalation: { tier: 30, daysLeft: 29 },
      holder_mismatch: false, conditions_open: 2, conditions_overdue: 1,
    })
    expect(stormwater).toMatchObject({ standing: 'no_expiry', escalation: null, holder_mismatch: true, conditions_open: 0 })
  })

  it('never lists another tenant\'s permits', async () => {
    seed('environmental_permits', [permitRow({ id: PERMIT_B, tenant_id: TENANT_B })])
    const body = await (await permits.GET(jsonRequest('/api/environmental/permits', 'GET'))).json()
    expect(body.permits).toEqual([])
  })

  it('filters by status, program, standing, business-critical and holder mismatch', async () => {
    seed('environmental_permits', [
      permitRow(),
      permitRow({ id: 'f0000000-0000-4000-8000-0000000000a3', permit_number: 'DEMO-A-1', program: 'air',
        holder_of_record: OLD_ENTITY, business_critical: false, expires_on: '2030-01-01', renewal_application_due_on: null }),
      permitRow({ id: 'f0000000-0000-4000-8000-0000000000a4', permit_number: 'DEMO-OLD', retired_at: '2025-01-01T00:00:00Z', retired_reason: 'Replaced' }),
    ])
    const ids = async (query: string) =>
      ((await (await permits.GET(jsonRequest(`/api/environmental/permits${query}`, 'GET'))).json()).permits as { id: string }[]).map(p => p.id)
    expect(await ids('')).toHaveLength(2)
    expect(await ids('?status=retired')).toEqual(['f0000000-0000-4000-8000-0000000000a4'])
    expect(await ids('?status=all')).toHaveLength(3)
    expect(await ids('?program=air')).toEqual(['f0000000-0000-4000-8000-0000000000a3'])
    expect(await ids('?standing=current')).toEqual(['f0000000-0000-4000-8000-0000000000a3'])
    expect(await ids('?business_critical=true')).toEqual([PERMIT_A])
    expect(await ids('?holder_mismatch=true')).toEqual(['f0000000-0000-4000-8000-0000000000a3'])
  })

  it.each(['?status=lapsed', '?program=noise', '?standing=fine', '?business_critical=yes'])('refuses %s', async query => {
    expect((await permits.GET(jsonRequest(`/api/environmental/permits${query}`, 'GET'))).status).toBe(400)
  })
})

describe('POST /permits', () => {
  it('records a permit at the active site, as its creator', async () => {
    const res = await permits.POST(jsonRequest('/x', 'POST', newPermit))
    expect(res.status).toBe(201)
    expect(rowsIn('environmental_permits')[0]).toMatchObject({
      tenant_id: TENANT_A, facility_id: FACILITY_A, program: 'air', instrument: 'registration', expires_on: null,
      created_by: ADMIN_A, updated_by: ADMIN_A,
    })
  })

  it('needs a site: a permit is issued to one', async () => {
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin', facilityId: null })
    const res = await permits.POST(jsonRequest('/x', 'POST', newPermit))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Select a facility/)
  })

  it('answers every problem at once, with the column names', async () => {
    const res = await permits.POST(jsonRequest('/x', 'POST', {
      ...newPermit, title: '', jurisdiction: 'Texas', expires_on: '2024-01-01', business_critical: 'yes',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field))
      .toEqual(['title', 'jurisdiction', 'expires_on', 'business_critical'])
  })

  it('holds the owner to a current member', async () => {
    const res = await permits.POST(jsonRequest('/x', 'POST', { ...newPermit, owner_user_id: '00000000-0000-4000-8000-0000000000ff' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'owner_user_id', message: 'is not a member of this organization' }])
    expect((await permits.POST(jsonRequest('/x', 'POST', { ...newPermit, owner_user_id: MEMBER_A }))).status).toBe(201)
  })

  it('refuses a second active permit with the same agency and number', async () => {
    seed('environmental_permits', [permitRow({ agency: newPermit.agency, permit_number: newPermit.permit_number })])
    expect((await permits.POST(jsonRequest('/x', 'POST', newPermit))).status).toBe(409)
  })
})

describe('GET and PATCH /permits/[id]', () => {
  beforeEach(() => seed('environmental_permits', [permitRow(), permitRow({ id: PERMIT_B, tenant_id: TENANT_B })]))

  it('returns the permit with its conditions, documents and the changes that touched it', async () => {
    seed('compliance_calendar_obligations', [{ id: 'c1', tenant_id: TENANT_A, permit_id: PERMIT_A, status: 'open', next_due_at: '2026-12-31' }])
    seed('ms_evidence', [{ id: 'd1', tenant_id: TENANT_A, subject_type: 'environmental_permit', subject_id: PERMIT_A, uploaded_at: '2026-09-01' }])
    seed('ms_change_impacts', [{ tenant_id: TENANT_A, change_id: 'ch1', target_type: 'permit', target_id: PERMIT_A, step: 'notify_agency' }])
    seed('ms_changes', [{ id: 'ch1', tenant_id: TENANT_A, kind: 'ownership_name', title: 'Sale of the plant', status: 'open', opened_at: '2026-09-15' }])
    const body = await (await permit.GET(jsonRequest('/x', 'GET'), idContext(PERMIT_A))).json()
    expect(body.permit.standing).toBe('renewal_due')
    expect(body.conditions.map((c: { id: string }) => c.id)).toEqual(['c1'])
    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(['d1'])
    expect(body.changes.map((c: { id: string }) => c.id)).toEqual(['ch1'])
  })

  it('answers 404 for another tenant\'s permit, and never edits it', async () => {
    expect((await permit.GET(jsonRequest('/x', 'GET'), idContext(PERMIT_B))).status).toBe(404)
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { notes: 'mine now' }), idContext(PERMIT_B))).status).toBe(404)
    expect(rowsIn('environmental_permits').find(p => p.id === PERMIT_B)?.notes).toBeNull()
  })

  it('edits the allowed fields only, and records who', async () => {
    const res = await permit.PATCH(jsonRequest('/x', 'PATCH', {
      holder_of_record: OLD_ENTITY, renewal_submitted_on: '2026-01-01', retired_at: '2026-01-01',
    }), idContext(PERMIT_A))
    expect(res.status).toBe(200)
    expect(rowsIn('environmental_permits')[0]).toMatchObject({
      holder_of_record: OLD_ENTITY, renewal_submitted_on: null, retired_at: null, updated_by: ADMIN_A,
    })
  })

  it('validates the merged permit, and refuses an empty change', async () => {
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { expires_on: '2021-01-01' }), idContext(PERMIT_A))).status).toBe(400)
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { colour: 'blue' }), idContext(PERMIT_A))).status).toBe(400)
  })

  it('assigns and clears the owner, holding it to a member', async () => {
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { owner_user_id: MEMBER_A }), idContext(PERMIT_A))).status).toBe(200)
    expect(rowsIn('environmental_permits')[0].owner_user_id).toBe(MEMBER_A)
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { owner_user_id: null }), idContext(PERMIT_A))).status).toBe(200)
    expect(rowsIn('environmental_permits')[0].owner_user_id).toBeNull()
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { owner_user_id: 'someone' }), idContext(PERMIT_A))).status).toBe(400)
  })

  it('keeps a retired permit as history', async () => {
    rowsIn('environmental_permits')[0].retired_at = '2026-01-01T00:00:00Z'
    rowsIn('environmental_permits')[0].retired_reason = 'Surrendered'
    expect((await permit.PATCH(jsonRequest('/x', 'PATCH', { notes: 'x' }), idContext(PERMIT_A))).status).toBe(409)
  })
})

describe('POST /permits/[id]/renewal', () => {
  beforeEach(() => seed('environmental_permits', [permitRow()]))
  const post = (body: unknown) => renewal.POST(jsonRequest('/x', 'POST', body), idContext(PERMIT_A))

  it('records the renewal application, which stops the countdown', async () => {
    expect((await post({ action: 'submitted', submitted_on: '2026-09-28' })).status).toBe(200)
    expect(rowsIn('environmental_permits')[0].renewal_submitted_on).toBe('2026-09-28')
  })

  it('refuses a submission dated in the future or before the current term', async () => {
    expect((await post({ action: 'submitted', submitted_on: '2026-10-09' })).status).toBe(400)
    expect((await post({ action: 'submitted', submitted_on: '2021-12-31' })).status).toBe(400)
  })

  it('records the renewed term and clears "submitted", so a new countdown starts', async () => {
    rowsIn('environmental_permits')[0].renewal_submitted_on = '2026-09-28'
    const res = await post({ action: 'renewed', issued_on: '2027-01-01', expires_on: '2032-01-01', renewal_application_due_on: '2031-07-01', permit_number: 'DEMO-IWD-0002' })
    expect(res.status).toBe(200)
    expect(rowsIn('environmental_permits')[0]).toMatchObject({
      issued_on: '2027-01-01', expires_on: '2032-01-01', renewal_application_due_on: '2031-07-01',
      renewal_submitted_on: null, permit_number: 'DEMO-IWD-0002',
    })
  })

  it('keeps the number when the renewal does not change it', async () => {
    await post({ action: 'renewed', issued_on: '2027-01-01', expires_on: '2032-01-01' })
    expect(rowsIn('environmental_permits')[0].permit_number).toBe('DEMO-IWD-0001')
  })

  it('refuses a term that does not start after the current one, and an unknown action', async () => {
    expect((await post({ action: 'renewed', issued_on: '2021-06-01', expires_on: '2032-01-01' })).status).toBe(400)
    expect((await post({ action: 'extended' })).status).toBe(400)
  })

  it('refuses when the permit changed meanwhile, rather than overwrite it', async () => {
    beforeNext('environmental_permits', 'update', () => { rowsIn('environmental_permits')[0].issued_on = '2026-06-01' })
    expect((await post({ action: 'renewed', issued_on: '2027-01-01', expires_on: '2032-01-01' })).status).toBe(409)
    expect(rowsIn('environmental_permits')[0].expires_on).toBe('2027-01-01')
  })

  it('does not renew a retired permit', async () => {
    Object.assign(rowsIn('environmental_permits')[0], { retired_at: '2026-01-01T00:00:00Z', retired_reason: 'x' })
    expect((await post({ action: 'submitted', submitted_on: TODAY })).status).toBe(409)
  })
})

describe('POST /permits/[id]/retire and /review', () => {
  beforeEach(() => seed('environmental_permits', [permitRow(), permitRow({ id: PERMIT_B, tenant_id: TENANT_B })]))

  it('retires with a reason, once', async () => {
    expect((await retire.POST(jsonRequest('/x', 'POST', { retired_reason: ' ' }), idContext(PERMIT_A))).status).toBe(400)
    expect((await retire.POST(jsonRequest('/x', 'POST', { retired_reason: 'Line closed' }), idContext(PERMIT_A))).status).toBe(200)
    expect(rowsIn('environmental_permits')[0]).toMatchObject({ retired_reason: 'Line closed', updated_by: ADMIN_A })
    expect((await retire.POST(jsonRequest('/x', 'POST', { retired_reason: 'Again' }), idContext(PERMIT_A))).status).toBe(409)
    expect((await retire.POST(jsonRequest('/x', 'POST', { retired_reason: 'x' }), idContext(PERMIT_B))).status).toBe(404)
  })

  it('stamps a review on a permit, which has no discipline to filter on', async () => {
    expect((await review.POST(jsonRequest('/x', 'POST'), idContext(PERMIT_A))).status).toBe(200)
    expect(rowsIn('environmental_permits')[0]).toMatchObject({ reviewed_by: ADMIN_A, next_review_due: '2027-10-02' })
    asAdminB()
    expect((await review.POST(jsonRequest('/x', 'POST'), idContext(PERMIT_A))).status).toBe(404)
  })
})

describe('/permits/[id]/conditions', () => {
  beforeEach(() => seed('environmental_permits', [permitRow(), permitRow({ id: PERMIT_B, tenant_id: TENANT_B })]))
  const quarterly = { title: 'Quarterly self-monitoring report', next_due_at: '2026-12-31', cadence: 'quarterly', evaluation_cadence_days: 365 }

  it('adds a condition as an obligation linked to the permit, with its jurisdiction, site and category', async () => {
    const res = await conditions.POST(jsonRequest('/x', 'POST', { ...quarterly, regulatory_ref: 'Part III.B', owner_user_id: MEMBER_A }), idContext(PERMIT_A))
    expect(res.status).toBe(201)
    expect(rowsIn('compliance_calendar_obligations')[0]).toMatchObject({
      tenant_id: TENANT_A, facility_id: FACILITY_A, permit_id: PERMIT_A, discipline: 'ems', source_kind: 'permit',
      jurisdiction: 'local:Northfield', category: 'wastewater', regulatory_ref: 'Part III.B', cadence: 'quarterly',
      next_due_at: '2026-12-31', owner_user_id: MEMBER_A, source: 'tenant', created_by: ADMIN_A,
    })
  })

  it('cites the permit number when the condition gives no reference', async () => {
    await conditions.POST(jsonRequest('/x', 'POST', quarterly), idContext(PERMIT_A))
    expect(rowsIn('compliance_calendar_obligations')[0].regulatory_ref).toBe('DEMO-IWD-0001')
  })

  it('needs a due date, and refuses a source or jurisdiction other than the permit\'s', async () => {
    const res = await conditions.POST(jsonRequest('/x', 'POST', { title: 'Opacity limit' }), idContext(PERMIT_A))
    expect(res.status).toBe(400)
    await conditions.POST(jsonRequest('/x', 'POST', { ...quarterly, source_kind: 'law', jurisdiction: 'federal' }), idContext(PERMIT_A))
    expect(rowsIn('compliance_calendar_obligations')[0]).toMatchObject({ source_kind: 'permit', jurisdiction: 'local:Northfield' })
  })

  it('takes no conditions on a retired permit or another tenant\'s', async () => {
    Object.assign(rowsIn('environmental_permits')[0], { retired_at: '2026-01-01T00:00:00Z', retired_reason: 'x' })
    expect((await conditions.POST(jsonRequest('/x', 'POST', quarterly), idContext(PERMIT_A))).status).toBe(409)
    expect((await conditions.POST(jsonRequest('/x', 'POST', quarterly), idContext(PERMIT_B))).status).toBe(404)
    expect(rowsIn('compliance_calendar_obligations')).toEqual([])
  })

  it('lists the permit\'s conditions, soonest due first', async () => {
    seed('compliance_calendar_obligations', [
      { id: 'late', tenant_id: TENANT_A, permit_id: PERMIT_A, next_due_at: '2027-03-31' },
      { id: 'soon', tenant_id: TENANT_A, permit_id: PERMIT_A, next_due_at: '2026-12-31' },
      { id: 'other', tenant_id: TENANT_A, permit_id: null, next_due_at: '2026-11-30' },
    ])
    const body = await (await conditions.GET(jsonRequest('/x', 'GET'), idContext(PERMIT_A))).json()
    expect(body.conditions.map((c: { id: string }) => c.id)).toEqual(['soon', 'late'])
  })
})
