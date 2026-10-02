// fetchIso14001Signals turns the tenant's registers into the plain signals
// the report card grades. A wrong filter here mis-grades an audit clause
// without any error, so the mapping is tested against a store that really
// applies the filters: environmental and integrated rows only, active rows
// only, the policy judged by the same rules the policy route applies.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TENANT_A, TENANT_B, resetStore, seed } from '../api/environmental/_emsHarness'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('../api/environmental/_emsHarness')).emsClient }))

import { fetchIso14001Signals } from '@/lib/iso14001Signals'

const TODAY = '2026-10-02'
const PAST = '2026-01-01'
const FUTURE = '2027-06-01'
const COMPLETE = { 'ems.protect_environment': true, 'ems.fulfil_obligations': true, 'ems.continual_improvement': true }

beforeEach(() => {
  resetStore()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
})
afterEach(() => vi.useRealTimers())

const signals = () => fetchIso14001Signals(TENANT_A, { environmental: true })

describe('fetchIso14001Signals — the Phase 1 registers', () => {
  it('reads an empty tenant as nothing recorded', async () => {
    expect(await signals()).toMatchObject({
      contextIssuesActive: 0, climateIssueRecorded: false, interestedPartiesActive: 0,
      scopeOnFile: false, policyApproved: false, policySignatoryStale: false,
      aspectsTotal: 0, aspectsUnscored: 0, obligationsTotal: 0, complianceEvalAgeDays: null, evaluationsOverdue: 0,
    })
  })

  it('counts active environmental context issues and parties, and spots the climate issue', async () => {
    seed('ms_context_issues', [
      { tenant_id: TENANT_A, discipline: 'ems', kind: 'climate', retired_at: null, next_review_due: FUTURE },
      { tenant_id: TENANT_A, discipline: 'integrated', kind: 'external', retired_at: null, next_review_due: PAST },
      { tenant_id: TENANT_A, discipline: 'ems', kind: 'internal', retired_at: '2026-02-01T00:00:00Z', next_review_due: PAST },
      { tenant_id: TENANT_A, discipline: 'ohs', kind: 'climate', retired_at: null, next_review_due: PAST },
      { tenant_id: TENANT_B, discipline: 'ems', kind: 'climate', retired_at: null, next_review_due: PAST },
    ])
    seed('ms_interested_parties', [
      { tenant_id: TENANT_A, discipline: 'ems', retired_at: null, next_review_due: PAST },
    ])
    expect(await signals()).toMatchObject({
      contextIssuesActive: 2, contextIssuesReviewOverdue: 1, climateIssueRecorded: true,
      interestedPartiesActive: 1, interestedPartiesReviewOverdue: 1,
    })
  })

  it('judges the policy in force like the policy route: complete, current, and signed by the current owner', async () => {
    seed('ms_scope_statements', [
      { tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'Northfield Forge & Finish LLC', effective_from: '2025-01-01', next_review_due: FUTURE },
      { tenant_id: TENANT_A, discipline: 'ems', version: 2, legal_entity: 'Northfield Holdings LLC', effective_from: '2026-06-01', next_review_due: PAST },
    ])
    seed('ms_policies', [
      { tenant_id: TENANT_A, discipline: 'ems', version: 1, commitments: { 'ems.protect_environment': true }, signatory_name: 'A', signed_at: '2024-01-01', next_review_due: FUTURE },
      { tenant_id: TENANT_A, discipline: 'ems', version: 2, commitments: COMPLETE, signatory_name: 'Plant Manager', signed_at: '2026-03-01', next_review_due: FUTURE },
    ])
    expect(await signals()).toMatchObject({
      scopeOnFile: true, scopeReviewOverdue: true,
      policyApproved: true, policyReviewOverdue: false, policySignatoryStale: true,
    })
  })

  it('reads aspects from the register: active only, scored or not, significant from the method', async () => {
    seed('ms_scoring_methods', [{ id: 'm1', tenant_id: TENANT_A, severity_levels: 5, likelihood_levels: 5, matrix: null, significance_threshold: 12 }])
    seed('environmental_aspects', [
      { id: 'a1', tenant_id: TENANT_A, obsolete_at: null, next_review_due: FUTURE, controls: null, related_risk_id: null },
      { id: 'a2', tenant_id: TENANT_A, obsolete_at: null, next_review_due: PAST, controls: 'Bunded', related_risk_id: null },
      { id: 'a3', tenant_id: TENANT_A, obsolete_at: '2026-01-01T00:00:00Z', next_review_due: PAST, controls: null, related_risk_id: null },
    ])
    seed('environmental_aspect_scores', [
      { id: 's1', tenant_id: TENANT_A, aspect_id: 'a1', method_id: 'm1', operating_condition: 'emergency', severity: 4, likelihood: 4, scored_at: '2026-09-01T00:00:00Z' },
      { id: 's3', tenant_id: TENANT_A, aspect_id: 'a3', method_id: 'm1', operating_condition: 'normal', severity: 5, likelihood: 5, scored_at: '2026-09-01T00:00:00Z' },
    ])
    expect(await signals()).toMatchObject({
      aspectsTotal: 2, aspectsSignificant: 1, significantUncontrolled: 1, aspectsUnscored: 1, aspectsReviewOverdue: 1,
    })
  })

  it('reads obligations from the environmental register and evaluations from their record', async () => {
    seed('compliance_calendar_obligations', [
      { tenant_id: TENANT_A, discipline: 'ems', status: 'open', next_due_at: PAST, next_review_due: FUTURE },
      { tenant_id: TENANT_A, discipline: 'integrated', status: 'open', next_due_at: FUTURE, next_review_due: PAST },
      { tenant_id: TENANT_A, discipline: 'ohs', status: 'open', next_due_at: PAST, next_review_due: PAST },
      { tenant_id: TENANT_A, discipline: 'ems', status: 'dismissed', next_due_at: PAST, next_review_due: PAST },
    ])
    seed('ms_compliance_evaluations', [
      { tenant_id: TENANT_A, discipline: 'ems', completed_at: '2026-09-22T09:00:00Z', scheduled_for: '2026-09-20' },
      { tenant_id: TENANT_A, discipline: 'ems', completed_at: null, scheduled_for: '2026-09-25' },
      { tenant_id: TENANT_A, discipline: 'ohs', completed_at: null, scheduled_for: '2026-09-25' },
    ])
    expect(await signals()).toMatchObject({
      obligationsTotal: 2, obligationsOverdue: 1, obligationsReviewOverdue: 1,
      complianceEvalAgeDays: 10, evaluationsOverdue: 1,
    })
  })
})
