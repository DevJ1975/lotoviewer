// The context, interested-party, scope and policy registers (clauses 4.1,
// 4.2, 4.3, 5.2) behind /api/environmental. Each route must pass gate
// failures through, refuse writes from non-admins, validate the whole
// record with field errors, and never read or write across tenants.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ADMIN_A, TENANT_A, TENANT_B,
  asAdminB, asMemberA, callAs, failNext, gateRejects, idContext, jsonRequest, resetStore, rowsIn, seed, writes,
} from './_emsHarness'

import * as contextIssues from '@/app/api/environmental/context-issues/route'
import * as contextIssue from '@/app/api/environmental/context-issues/[id]/route'
import * as contextIssueReview from '@/app/api/environmental/context-issues/[id]/review/route'
import * as parties from '@/app/api/environmental/interested-parties/route'
import * as party from '@/app/api/environmental/interested-parties/[id]/route'
import * as scope from '@/app/api/environmental/scope/route'
import * as policy from '@/app/api/environmental/policy/route'
import * as policyCommunications from '@/app/api/environmental/policy/communications/route'

const ISSUE_A = 'c0000000-0000-4000-8000-00000000000a'
const OBLIGATION_A = 'b0000000-0000-4000-8000-00000000000a'
const OBLIGATION_B = 'b0000000-0000-4000-8000-00000000000b'
const POLICY_A = 'd0000000-0000-4000-8000-00000000000a'
const POLICY_B = 'd0000000-0000-4000-8000-00000000000b'

function contextIssueRow(over: Record<string, unknown> = {}) {
  return {
    id: ISSUE_A, tenant_id: TENANT_A, facility_id: null, discipline: 'ems', kind: 'external',
    description: 'New stormwater general permit takes effect next year', relevance: null, effect: 'risk',
    retired_at: null, retired_reason: null, last_reviewed_at: null, reviewed_by: null,
    next_review_due: '2027-06-01', created_at: '2026-06-01T00:00:00Z', ...over,
  }
}

const validPolicy = {
  body: 'Northfield Forge & Finish protects the environment, prevents pollution, meets its obligations and keeps improving.',
  commitments: { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': true },
  signatory_name: 'Plant Manager',
  signed_at: '2026-09-15',
}

const validScope = {
  legal_entity: 'Northfield Forge & Finish LLC',
  physical_boundary: 'The fenced Northfield, TX site, including the stormwater outfall',
  activities: 'Forging, machining, powder coating, shipping',
  products_services: 'Forged steel brackets and fittings',
  control_and_influence: 'We control every on-site operation; we influence our steel suppliers and freight carriers.',
  effective_from: '2026-09-01',
}

const validCommunication = {
  policy_id: POLICY_A, audience: 'internal', method: 'Posted at both entrances; read out at the all-hands', communicated_on: '2026-09-20',
}

function policyRow(over: Record<string, unknown> = {}) {
  return {
    id: POLICY_A, tenant_id: TENANT_A, discipline: 'ems', version: 1, ...validPolicy,
    next_review_due: '2027-09-15', created_at: '2026-09-15T00:00:00Z', ...over,
  }
}

beforeEach(resetStore)

describe('gating, for every register route', () => {
  const reads: [string, () => Promise<Response>][] = [
    ['GET context-issues', () => contextIssues.GET(jsonRequest('/api/environmental/context-issues', 'GET'))],
    ['GET interested-parties', () => parties.GET(jsonRequest('/api/environmental/interested-parties', 'GET'))],
    ['GET scope', () => scope.GET(jsonRequest('/api/environmental/scope', 'GET'))],
    ['GET policy', () => policy.GET(jsonRequest('/api/environmental/policy', 'GET'))],
  ]
  const writeCalls: [string, () => Promise<Response>][] = [
    ['POST context-issues', () => contextIssues.POST(jsonRequest('/x', 'POST', { kind: 'climate', description: 'Heat' }))],
    ['PATCH context-issue', () => contextIssue.PATCH(jsonRequest('/x', 'PATCH', { description: 'x' }), idContext(ISSUE_A))],
    ['POST context-issue review', () => contextIssueReview.POST(jsonRequest('/x', 'POST'), idContext(ISSUE_A))],
    ['POST interested-parties', () => parties.POST(jsonRequest('/x', 'POST', { name: 'n', needs_expectations: 'e' }))],
    ['PATCH interested-party', () => party.PATCH(jsonRequest('/x', 'PATCH', { name: 'n' }), idContext(ISSUE_A))],
    ['POST scope', () => scope.POST(jsonRequest('/x', 'POST', validScope))],
    ['POST policy', () => policy.POST(jsonRequest('/x', 'POST', validPolicy))],
    ['POST policy communication', () => policyCommunications.POST(jsonRequest('/x', 'POST', validCommunication))],
  ]

  it.each([...reads, ...writeCalls])('%s passes an authentication failure through', async (_name, call) => {
    gateRejects(401, 'Missing bearer token')
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Missing bearer token' })
  })

  it.each([...reads, ...writeCalls])('%s answers 403 when the module is off', async (_name, call) => {
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'owner', moduleOn: false })
    expect((await call()).status).toBe(403)
  })

  it.each(writeCalls)('%s refuses a member, and writes nothing', async (_name, call) => {
    seed('ms_context_issues', [contextIssueRow()])
    asMemberA()
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Tenant admin or owner required' })
    expect(writes).toEqual([])
  })

  it.each(reads)('%s lets a member read', async (_name, call) => {
    asMemberA()
    expect((await call()).status).toBe(200)
  })
})

describe('context issues', () => {
  it('records an issue for the gate tenant, defaulting to the environmental discipline', async () => {
    const res = await contextIssues.POST(jsonRequest('/x', 'POST', {
      kind: 'climate', description: '  Hotter summers raise cooling-water demand  ', effect: 'risk',
      tenant_id: TENANT_B, created_by: 'someone-else',
    }))
    expect(res.status).toBe(201)
    const { issue } = await res.json()
    expect(issue).toMatchObject({
      tenant_id: TENANT_A, discipline: 'ems', kind: 'climate', effect: 'risk',
      description: 'Hotter summers raise cooling-water demand', created_by: ADMIN_A,
    })
    // Organization-wide in Phase 1: the route never stamps a facility.
    expect(writes[0].payload).not.toHaveProperty('facility_id')
  })

  it('reports every field problem at once, with the column names', async () => {
    const res = await contextIssues.POST(jsonRequest('/x', 'POST', { kind: 'political', effect: 'threat' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.fieldErrors.map((e: { field: string }) => e.field)).toEqual(['kind', 'description', 'effect'])
    expect(writes).toEqual([])
  })

  it('refuses an OH&S issue: the environmental routes write ems and integrated records only', async () => {
    const res = await contextIssues.POST(jsonRequest('/x', 'POST', { discipline: 'ohs', kind: 'internal', description: 'x' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'discipline', message: 'must be ems or integrated' }])
  })

  it('refuses a body that is not a JSON object', async () => {
    for (const body of ['[1,2]', 'not json', 'null']) {
      expect((await contextIssues.POST(jsonRequest('/x', 'POST', body))).status).toBe(400)
    }
  })

  it('lists only the gate tenant\'s active environmental issues', async () => {
    seed('ms_context_issues', [
      contextIssueRow(),
      contextIssueRow({ id: 'c1', retired_at: '2026-07-01T00:00:00Z', retired_reason: 'Permit withdrawn' }),
      contextIssueRow({ id: 'c2', discipline: 'ohs' }),
      contextIssueRow({ id: 'c3', tenant_id: TENANT_B }),
    ])
    const ids = async (status?: string) => {
      const res = await contextIssues.GET(jsonRequest(`/api/environmental/context-issues${status ? `?status=${status}` : ''}`, 'GET'))
      return (await res.json()).issues.map((i: { id: string }) => i.id)
    }
    expect(await ids()).toEqual([ISSUE_A])
    expect(await ids('retired')).toEqual(['c1'])
    expect((await ids('all')).sort()).toEqual([ISSUE_A, 'c1'].sort())
    expect((await contextIssues.GET(jsonRequest('/api/environmental/context-issues?status=gone', 'GET'))).status).toBe(400)
  })

  it('edits only the fields sent, validating the whole record', async () => {
    seed('ms_context_issues', [contextIssueRow()])
    const res = await contextIssue.PATCH(jsonRequest('/x', 'PATCH', { effect: 'both', tenant_id: TENANT_B }), idContext(ISSUE_A))
    expect(res.status).toBe(200)
    expect(writes.at(-1)?.payload).toEqual({ updated_by: ADMIN_A, effect: 'both' })
    expect(rowsIn('ms_context_issues')[0]).toMatchObject({ tenant_id: TENANT_A, effect: 'both' })
  })

  it('refuses an edit that would leave the record invalid', async () => {
    seed('ms_context_issues', [contextIssueRow()])
    const res = await contextIssue.PATCH(jsonRequest('/x', 'PATCH', { description: '   ' }), idContext(ISSUE_A))
    expect(res.status).toBe(400)
    expect(writes).toEqual([])
  })

  it('refuses an empty edit', async () => {
    seed('ms_context_issues', [contextIssueRow()])
    expect((await contextIssue.PATCH(jsonRequest('/x', 'PATCH', { tenant_id: TENANT_B }), idContext(ISSUE_A))).status).toBe(400)
  })

  it('retires with a reason, keeps the first retirement date, and reinstates with null', async () => {
    seed('ms_context_issues', [contextIssueRow()])
    const patch = (body: unknown) => contextIssue.PATCH(jsonRequest('/x', 'PATCH', body), idContext(ISSUE_A))

    expect((await patch({ retired_reason: '' })).status).toBe(400)

    expect((await patch({ retired_reason: 'Permit withdrawn' })).status).toBe(200)
    const firstRetiredAt = rowsIn('ms_context_issues')[0].retired_at
    expect(firstRetiredAt).toEqual(expect.any(String))

    await patch({ retired_reason: 'Permit withdrawn by the state' })
    expect(rowsIn('ms_context_issues')[0]).toMatchObject({ retired_at: firstRetiredAt, retired_reason: 'Permit withdrawn by the state' })

    await patch({ retired_reason: null })
    expect(rowsIn('ms_context_issues')[0]).toMatchObject({ retired_at: null, retired_reason: null })
  })

  it('answers 404 to another tenant\'s admin, and writes nothing', async () => {
    seed('ms_context_issues', [contextIssueRow()])
    asAdminB()
    expect((await contextIssue.PATCH(jsonRequest('/x', 'PATCH', { effect: 'both' }), idContext(ISSUE_A))).status).toBe(404)
    expect((await contextIssueReview.POST(jsonRequest('/x', 'POST'), idContext(ISSUE_A))).status).toBe(404)
    expect(rowsIn('ms_context_issues')[0]).toMatchObject({ effect: 'risk', last_reviewed_at: null })
  })

  it('refuses a malformed id before touching the database', async () => {
    expect((await contextIssue.PATCH(jsonRequest('/x', 'PATCH', { effect: 'both' }), idContext('nope'))).status).toBe(400)
    expect((await contextIssueReview.POST(jsonRequest('/x', 'POST'), idContext('nope'))).status).toBe(400)
  })

  it('records a review and pushes the next one a year out', async () => {
    seed('ms_context_issues', [contextIssueRow({ next_review_due: '2026-01-01' })])
    const res = await contextIssueReview.POST(jsonRequest('/x', 'POST'), idContext(ISSUE_A))
    expect(res.status).toBe(200)
    const today = new Date().toISOString().slice(0, 10)
    const [year, month, day] = today.split('-').map(Number)
    const nextYear = new Date(Date.UTC(year, month - 1, day + 365)).toISOString().slice(0, 10)
    expect(rowsIn('ms_context_issues')[0]).toMatchObject({ reviewed_by: ADMIN_A, next_review_due: nextYear })
  })

  it('hides a database failure behind a generic error', async () => {
    failNext('ms_context_issues', { code: 'XX000', message: 'relation internals leaked here' })
    const res = await contextIssues.GET(jsonRequest('/api/environmental/context-issues', 'GET'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })

  it('leaves an OH&S issue to the OH&S module: no edit, no review stamp', async () => {
    seed('ms_context_issues', [contextIssueRow({ discipline: 'ohs' })])
    expect((await contextIssue.PATCH(jsonRequest('/x', 'PATCH', { discipline: 'ems' }), idContext(ISSUE_A))).status).toBe(404)
    expect((await contextIssueReview.POST(jsonRequest('/x', 'POST'), idContext(ISSUE_A))).status).toBe(404)
    expect(rowsIn('ms_context_issues')[0]).toMatchObject({ discipline: 'ohs', last_reviewed_at: null })
  })
})

describe('interested parties', () => {
  beforeEach(() => {
    seed('compliance_calendar_obligations', [
      { id: OBLIGATION_A, tenant_id: TENANT_A, title: 'Stormwater permit' },
      { id: OBLIGATION_B, tenant_id: TENANT_B, title: 'Another tenant\'s permit' },
    ])
  })

  const partyBody = {
    name: 'County water district', needs_expectations: 'Discharge within permit limits',
    becomes_obligation: true, obligation_id: OBLIGATION_A,
  }

  it('records a party whose need became one of the tenant\'s obligations', async () => {
    const res = await parties.POST(jsonRequest('/x', 'POST', partyBody))
    expect(res.status).toBe(201)
    expect((await res.json()).party).toMatchObject({ tenant_id: TENANT_A, obligation_id: OBLIGATION_A, discipline: 'ems' })
  })

  it('refuses a link to another tenant\'s obligation with a plain field error', async () => {
    const res = await parties.POST(jsonRequest('/x', 'POST', { ...partyBody, obligation_id: OBLIGATION_B }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'obligation_id', message: 'is not an obligation in this organization' }])
    expect(rowsIn('ms_interested_parties')).toEqual([])
  })

  it('refuses an obligation link on a need that is not adopted, and a malformed link', async () => {
    const unadopted = await parties.POST(jsonRequest('/x', 'POST', { ...partyBody, becomes_obligation: false }))
    expect((await unadopted.json()).fieldErrors).toEqual([
      { field: 'obligation_id', message: 'can only be set when the need becomes a compliance obligation' },
    ])
    const malformed = await parties.POST(jsonRequest('/x', 'POST', { ...partyBody, obligation_id: 'x' }))
    expect((await malformed.json()).fieldErrors).toEqual([{ field: 'obligation_id', message: 'must be an obligation id' }])
  })

  it('unlinks the obligation when the need stops being adopted in the same edit', async () => {
    await parties.POST(jsonRequest('/x', 'POST', partyBody))
    const id = rowsIn('ms_interested_parties')[0].id as string
    const res = await party.PATCH(jsonRequest('/x', 'PATCH', { becomes_obligation: false, obligation_id: null }), idContext(id))
    expect(res.status).toBe(200)
    expect(rowsIn('ms_interested_parties')[0]).toMatchObject({ becomes_obligation: false, obligation_id: null })
  })

  it('validates the stored record and the edit together', async () => {
    await parties.POST(jsonRequest('/x', 'POST', partyBody))
    const id = rowsIn('ms_interested_parties')[0].id as string
    const res = await party.PATCH(jsonRequest('/x', 'PATCH', { becomes_obligation: false }), idContext(id))
    expect(res.status).toBe(400)
    expect(rowsIn('ms_interested_parties')[0]).toMatchObject({ becomes_obligation: true })
  })

  it('lists only the gate tenant\'s parties', async () => {
    seed('ms_interested_parties', [
      { id: 'p1', tenant_id: TENANT_A, discipline: 'integrated', name: 'Neighbours', retired_at: null },
      { id: 'p2', tenant_id: TENANT_B, discipline: 'ems', name: 'Someone else\'s regulator', retired_at: null },
    ])
    const res = await parties.GET(jsonRequest('/api/environmental/interested-parties', 'GET'))
    expect((await res.json()).parties.map((p: { id: string }) => p.id)).toEqual(['p1'])
  })
})

describe('scope', () => {
  it('saves numbered versions and serves the newest as current', async () => {
    expect((await scope.POST(jsonRequest('/x', 'POST', validScope))).status).toBe(201)
    const second = await scope.POST(jsonRequest('/x', 'POST', { ...validScope, legal_entity: 'Northfield Holdings LLC' }))
    expect((await second.json()).scope).toMatchObject({ version: 2, approved_by: ADMIN_A, tenant_id: TENANT_A })

    const res = await scope.GET(jsonRequest('/api/environmental/scope', 'GET'))
    const body = await res.json()
    expect(body.current).toMatchObject({ version: 2, legal_entity: 'Northfield Holdings LLC' })
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1])
  })

  it('numbers versions per tenant', async () => {
    seed('ms_scope_statements', [{ id: 's-b', tenant_id: TENANT_B, discipline: 'ems', version: 7 }])
    const res = await scope.POST(jsonRequest('/x', 'POST', validScope))
    expect((await res.json()).scope.version).toBe(1)
  })

  it('defaults the effective date to today and refuses an impossible one', async () => {
    const res = await scope.POST(jsonRequest('/x', 'POST', { ...validScope, effective_from: undefined }))
    expect((await res.json()).scope.effective_from).toBe(new Date().toISOString().slice(0, 10))
    const bad = await scope.POST(jsonRequest('/x', 'POST', { ...validScope, effective_from: '2026-02-30' }))
    expect(bad.status).toBe(400)
  })

  it('requires what the organization can control and influence (4.3 e), and keeps exclusions when given', async () => {
    const missing = await scope.POST(jsonRequest('/x', 'POST', { ...validScope, control_and_influence: ' ' }))
    expect(missing.status).toBe(400)
    expect((await missing.json()).fieldErrors).toEqual([{ field: 'control_and_influence', message: 'is required' }])

    const res = await scope.POST(jsonRequest('/x', 'POST', { ...validScope, exclusions: '  The leased warehouse, run by its landlord.  ' }))
    expect((await res.json()).scope).toMatchObject({
      control_and_influence: validScope.control_and_influence, exclusions: 'The leased warehouse, run by its landlord.',
    })
  })

  it('stores no exclusions as null, not as an empty statement', async () => {
    await scope.POST(jsonRequest('/x', 'POST', { ...validScope, exclusions: '' }))
    expect(writes[0].payload).toMatchObject({ exclusions: null })
  })

  it('answers 409 when another admin saved the same version first', async () => {
    failNext('ms_scope_statements', { code: '23505', message: 'duplicate key' }, 'insert')
    const res = await scope.POST(jsonRequest('/x', 'POST', validScope))
    expect(res.status).toBe(409)
  })

  it('refuses a discipline the environmental registers do not show', async () => {
    expect((await scope.GET(jsonRequest('/api/environmental/scope?discipline=ohs', 'GET'))).status).toBe(400)
  })

  it('shows another tenant nothing', async () => {
    await scope.POST(jsonRequest('/x', 'POST', validScope))
    asAdminB()
    const body = await (await scope.GET(jsonRequest('/api/environmental/scope', 'GET'))).json()
    expect(body).toEqual({ current: null, versions: [] })
  })
})

describe('policy', () => {
  it('saves a complete policy as version 1', async () => {
    const res = await policy.POST(jsonRequest('/x', 'POST', validPolicy))
    expect(res.status).toBe(201)
    expect((await res.json()).policy).toMatchObject({
      version: 1, tenant_id: TENANT_A, discipline: 'ems', created_by: ADMIN_A, signatory_title: null,
    })
  })

  it('answers 422 naming each commitment the policy leaves out', async () => {
    const res = await policy.POST(jsonRequest('/x', 'POST', {
      ...validPolicy, commitments: { 'ems.protect_environment': true, 'ems.continual_improvement': false },
    }))
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.missingCommitments.map((c: { key: string }) => c.key))
      .toEqual(['ems.fulfil_obligations', 'ems.continual_improvement'])
    expect(rowsIn('ms_policies')).toEqual([])
  })

  it('requires an integrated policy to state the OH&S commitments too', async () => {
    const res = await policy.POST(jsonRequest('/x', 'POST', { ...validPolicy, discipline: 'integrated' }))
    expect(res.status).toBe(422)
    expect((await res.json()).missingCommitments).toHaveLength(5)
  })

  it('answers 400, not 422, for a malformed policy', async () => {
    const res = await policy.POST(jsonRequest('/x', 'POST', { ...validPolicy, commitments: ['ems.protect_environment'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([
      { field: 'commitments', message: 'must be an object of commitment keys to true or false' },
    ])
  })

  it('reports the current policy, what it must state, and whether it is complete', async () => {
    await policy.POST(jsonRequest('/x', 'POST', validPolicy))
    asMemberA()
    const body = await (await policy.GET(jsonRequest('/api/environmental/policy', 'GET'))).json()
    expect(body.current).toMatchObject({ version: 1 })
    expect(body.complete).toBe(true)
    expect(body.signatoryStale).toBe(false)
    expect(body.requiredCommitments.map((c: { key: string }) => c.key))
      .toEqual(['ems.protect_environment', 'ems.fulfil_obligations', 'ems.continual_improvement'])
  })

  it('flags a policy signed before the legal entity changed', async () => {
    await policy.POST(jsonRequest('/x', 'POST', validPolicy))
    seed('ms_scope_statements', [
      { tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'Northfield Forge & Finish LLC', effective_from: '2025-01-01' },
      { tenant_id: TENANT_A, discipline: 'ems', version: 2, legal_entity: 'Northfield Holdings LLC', effective_from: '2026-09-20' },
    ])
    const body = await (await policy.GET(jsonRequest('/api/environmental/policy', 'GET'))).json()
    expect(body.signatoryStale).toBe(true)
  })

  it('reports no policy as incomplete rather than failing', async () => {
    const body = await (await policy.GET(jsonRequest('/api/environmental/policy', 'GET'))).json()
    expect(body).toMatchObject({
      current: null, versions: [], complete: false, signatoryStale: false, communications: [], communicatedInternally: false,
    })
  })

  it('reports how the policy in force has been communicated, newest first, and only that version\'s', async () => {
    seed('ms_policies', [policyRow({ id: 'p-old', version: 1 }), policyRow({ version: 2 })])
    seed('ms_policy_communications', [
      { tenant_id: TENANT_A, discipline: 'ems', policy_id: 'p-old', audience: 'internal', method: 'Old notice', communicated_on: '2025-01-10' },
      { tenant_id: TENANT_A, discipline: 'ems', policy_id: POLICY_A, audience: 'external', method: 'Company website', communicated_on: '2026-09-01' },
      { tenant_id: TENANT_A, discipline: 'ems', policy_id: POLICY_A, audience: 'external', method: 'Sent to our main customer', communicated_on: '2026-09-25' },
    ])
    const body = await (await policy.GET(jsonRequest('/api/environmental/policy', 'GET'))).json()
    expect(body.communications.map((c: { method: string }) => c.method)).toEqual(['Sent to our main customer', 'Company website'])
    // Version 1 was communicated within the organization; version 2 has only been published outside it.
    expect(body.communicatedInternally).toBe(false)
  })
})

describe('policy communications', () => {
  beforeEach(() => seed('ms_policies', [policyRow(), policyRow({ id: POLICY_B, tenant_id: TENANT_B })]))

  it('records a communication of the tenant\'s policy, by whom, in the policy\'s discipline', async () => {
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, tenant_id: TENANT_B, recorded_by: 'x' }))
    expect(res.status).toBe(201)
    expect((await res.json()).communication).toMatchObject({
      tenant_id: TENANT_A, discipline: 'ems', policy_id: POLICY_A, audience: 'internal',
      communicated_on: '2026-09-20', recorded_by: ADMIN_A,
    })
  })

  it('takes the discipline from the policy, never from the body', async () => {
    const INTEGRATED = 'd0000000-0000-4000-8000-0000000000c1'
    seed('ms_policies', [policyRow({ id: INTEGRATED, discipline: 'integrated', version: 1 })])
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, policy_id: INTEGRATED, discipline: 'ems' }))
    expect(res.status).toBe(201)
    expect((await res.json()).communication.discipline).toBe('integrated')
  })

  it('answers 404 for another tenant\'s policy, and writes nothing', async () => {
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, policy_id: POLICY_B }))
    expect(res.status).toBe(404)
    expect(writes).toEqual([])
  })

  it('defaults the date to today, and refuses one in the future', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, communicated_on: undefined }))
    expect((await res.json()).communication.communicated_on).toBe(today)
    const future = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, communicated_on: '2999-01-01' }))
    expect(future.status).toBe(400)
    expect((await future.json()).fieldErrors).toEqual([{ field: 'communicated_on', message: 'cannot be in the future' }])
  })

  it('refuses a communication dated before the policy version was signed', async () => {
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, communicated_on: '2026-09-14' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([
      { field: 'communicated_on', message: 'cannot be before the policy was signed (2026-09-15)' },
    ])
    expect(writes).toEqual([])
  })

  it('accepts a site\'s own today when it is already tomorrow in UTC terms, but not the day after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'))   // already 2026-10-03 east of UTC+12
    try {
      const ahead = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, communicated_on: '2026-10-03' }))
      expect(ahead.status).toBe(201)
      const future = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, communicated_on: '2026-10-04' }))
      expect(future.status).toBe(400)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports every field problem at once, with the column names', async () => {
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { policy_id: POLICY_A, audience: 'everyone', method: '' }))
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field)).toEqual(['audience', 'method'])
  })

  it('refuses a policy id that is not an id', async () => {
    const res = await policyCommunications.POST(jsonRequest('/x', 'POST', { ...validCommunication, policy_id: 'latest' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'policy_id', message: 'must be a policy id' }])
  })
})
