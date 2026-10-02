// GET /api/environmental/registers/health: one traffic light per register.
// Each light walks red → amber → green on the rules in packages/core, and
// counts only the caller's tenant and the environmental disciplines.

import { describe, it, expect, beforeEach } from 'vitest'
import { ADMIN_A, TENANT_A, TENANT_B, asMemberA, callAs, gateRejects, jsonRequest, resetStore, seed } from './_emsHarness'
import { GET } from '@/app/api/environmental/registers/health/route'

const TODAY = new Date().toISOString().slice(0, 10)
const PAST = '2020-01-01'
const FUTURE = '2099-01-01'

async function health(query = '') {
  const res = await GET(jsonRequest(`/api/environmental/registers/health${query}`, 'GET'))
  return { status: res.status, body: await res.json() }
}

const issue = (over: Record<string, unknown>) => ({
  tenant_id: TENANT_A, discipline: 'ems', kind: 'external', retired_at: null, next_review_due: FUTURE, ...over,
})
const aspect = (over: Record<string, unknown>) => ({
  tenant_id: TENANT_A, obsolete_at: null, next_review_due: FUTURE, ...over,
})
const obligation = (over: Record<string, unknown>) => ({
  tenant_id: TENANT_A, discipline: 'ems', status: 'open', next_review_due: FUTURE, evaluation_cadence_days: 365, ...over,
})
const COMPLETE_COMMITMENTS = { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': true }

beforeEach(resetStore)

describe('GET /api/environmental/registers/health', () => {
  it('is red everywhere for a tenant that has recorded nothing', async () => {
    const { status, body } = await health()
    expect(status).toBe(200)
    expect(body).toMatchObject({
      asOf: TODAY,
      context: { health: 'red', active: 0 },
      scopeAndPolicy: { health: 'red', scopeVersion: null, policyVersion: null },
      aspects: { health: 'red', active: 0 },
      obligations: { health: 'red', active: 0 },
    })
  })

  it('keeps the context register amber until a climate issue is recorded', async () => {
    seed('ms_context_issues', [issue({ id: 'i1' })])
    expect((await health()).body.context).toEqual({ health: 'amber', active: 1, reviewOverdue: 0, climateRecorded: false })
    seed('ms_context_issues', [issue({ id: 'i2', kind: 'climate' })])
    expect((await health()).body.context.health).toBe('green')
    seed('ms_context_issues', [issue({ id: 'i3', next_review_due: PAST })])
    expect((await health()).body.context).toMatchObject({ health: 'amber', reviewOverdue: 1 })
  })

  it('ignores retired, OH&S-only and other tenants\' issues', async () => {
    seed('ms_context_issues', [
      issue({ id: 'i1', kind: 'climate', retired_at: '2026-01-01T00:00:00Z', retired_reason: 'x' }),
      issue({ id: 'i2', kind: 'climate', discipline: 'ohs' }),
      issue({ id: 'i3', kind: 'climate', tenant_id: TENANT_B }),
    ])
    expect((await health()).body.context).toMatchObject({ health: 'red', active: 0 })
  })

  it('turns aspects amber for an unscored aspect and green once every active one is scored', async () => {
    seed('ms_scoring_methods', [{ id: 'm1', tenant_id: TENANT_A, severity_levels: 5, likelihood_levels: 5, matrix: null, significance_threshold: 12 }])
    seed('environmental_aspects', [aspect({ id: 'a1' }), aspect({ id: 'a-old', obsolete_at: '2026-01-01T00:00:00Z' })])
    expect((await health()).body.aspects).toEqual({ health: 'amber', active: 1, reviewOverdue: 0, unscored: 1 })
    seed('environmental_aspect_scores', [{
      id: 's1', tenant_id: TENANT_A, aspect_id: 'a1', method_id: 'm1', operating_condition: 'normal',
      severity: 2, likelihood: 2, scored_at: '2026-09-01T00:00:00Z',
    }])
    expect((await health()).body.aspects.health).toBe('green')
  })

  it('turns obligations amber for an evaluation past due, ignoring dismissed obligations', async () => {
    seed('compliance_calendar_obligations', [obligation({ id: 'o1' }), obligation({ id: 'o2', status: 'dismissed', next_review_due: PAST })])
    expect((await health()).body.obligations.health).toBe('green')
    seed('ms_compliance_evaluations', [{ id: 'e1', tenant_id: TENANT_A, discipline: 'ems', completed_at: null, scheduled_for: PAST }])
    expect((await health()).body.obligations).toEqual({ health: 'amber', active: 1, reviewOverdue: 0, evaluationsOverdue: 1, unscheduled: 0 })
  })

  it('turns obligations amber for one with no evaluation frequency, as clause 9.1.2 a) requires one for each', async () => {
    seed('compliance_calendar_obligations', [obligation({ id: 'o1' }), obligation({ id: 'o2', evaluation_cadence_days: null })])
    expect((await health()).body.obligations).toEqual({ health: 'amber', active: 2, reviewOverdue: 0, evaluationsOverdue: 0, unscheduled: 1 })
  })

  it('grades scope and policy together', async () => {
    seed('ms_scope_statements', [{ tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'Northfield Forge & Finish LLC', effective_from: '2026-01-01', next_review_due: FUTURE }])
    expect((await health()).body.scopeAndPolicy).toMatchObject({ health: 'red', scopeVersion: 1, policyVersion: null })

    seed('ms_policies', [{
      tenant_id: TENANT_A, discipline: 'ems', version: 1, commitments: { 'ems.protect_environment': true },
      signatory_name: 'Plant Manager', signed_at: '2026-02-01', next_review_due: FUTURE,
    }])
    expect((await health()).body.scopeAndPolicy).toMatchObject({ health: 'amber', policyComplete: false })

    seed('ms_policies', [{
      tenant_id: TENANT_A, discipline: 'ems', version: 2, commitments: COMPLETE_COMMITMENTS,
      signatory_name: 'Plant Manager', signed_at: '2026-02-01', next_review_due: FUTURE,
    }])
    expect((await health()).body.scopeAndPolicy).toEqual({
      health: 'green', scopeVersion: 1, policyVersion: 2, policyComplete: true, signatoryStale: false,
    })
  })

  it('lets a member read it, passes gate failures through, and refuses an OH&S discipline', async () => {
    asMemberA()
    expect((await health()).status).toBe(200)
    gateRejects(401, 'Invalid session')
    expect((await health()).status).toBe(401)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin', moduleOn: false })
    expect((await health()).status).toBe(403)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin' })
    expect((await health('?discipline=ohs')).status).toBe(400)
  })
})
