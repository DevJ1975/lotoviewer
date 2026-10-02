// fetchIso14001Signals turns the tenant's registers into the plain signals
// the report card grades. A wrong filter here mis-grades an audit clause
// without any error, so the mapping is tested against a store that really
// applies the filters: environmental and integrated rows only, active rows
// only, the policy judged by the same rules the policy route applies.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TENANT_A, TENANT_B, failNext, resetStore, seed } from '../api/environmental/_emsHarness'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('../api/environmental/_emsHarness')).emsClient }))

import { fetchIso14001Signals } from '@/lib/iso14001Signals'
import { assessIso14001 } from '@soteria/core/iso14001Readiness'

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

const signals = () => fetchIso14001Signals(TENANT_A)

describe('fetchIso14001Signals — the Phase 1 registers', () => {
  it('reads an empty tenant as nothing recorded', async () => {
    expect(await signals()).toMatchObject({
      contextIssuesActive: 0, climateIssueRecorded: false, interestedPartiesActive: 0,
      scopeOnFile: false, policyApproved: false, policySignatoryStale: false,
      aspectsTotal: 0, aspectsUnscored: 0, obligationsTotal: 0, complianceEvalAgeDays: null, evaluationsOverdue: 0,
      obligationsUnscheduled: 0, evaluationsUndetermined: 0,
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
      { id: 'o1', tenant_id: TENANT_A, discipline: 'ems', status: 'open', next_due_at: PAST, next_review_due: FUTURE, evaluation_cadence_days: 365 },
      { id: 'o2', tenant_id: TENANT_A, discipline: 'integrated', status: 'open', next_due_at: FUTURE, next_review_due: PAST, evaluation_cadence_days: null },
      { id: 'o3', tenant_id: TENANT_A, discipline: 'ohs', status: 'open', next_due_at: PAST, next_review_due: PAST },
      { id: 'o4', tenant_id: TENANT_A, discipline: 'ems', status: 'dismissed', next_due_at: PAST, next_review_due: PAST },
    ])
    seed('ms_compliance_evaluations', [
      { tenant_id: TENANT_A, discipline: 'ems', obligation_id: 'o1', completed_at: '2026-09-22T09:00:00Z', scheduled_for: '2026-09-20', result: 'compliant' },
      // Newer, but it established nothing: it neither dates the last evaluation nor settles the status.
      { tenant_id: TENANT_A, discipline: 'ems', obligation_id: 'o1', completed_at: '2026-09-30T09:00:00Z', scheduled_for: '2026-09-29', result: 'undetermined' },
      { tenant_id: TENANT_A, discipline: 'ems', obligation_id: 'o2', completed_at: null, scheduled_for: '2026-09-25' },
      { tenant_id: TENANT_A, discipline: 'ohs', obligation_id: 'o3', completed_at: null, scheduled_for: '2026-09-25' },
    ])
    expect(await signals()).toMatchObject({
      obligationsTotal: 2, obligationsOverdue: 1, obligationsReviewOverdue: 1,
      complianceEvalAgeDays: 10, evaluationsOverdue: 1, obligationsUnscheduled: 1, evaluationsUndetermined: 1,
    })
  })
})

describe('fetchIso14001Signals — the permit vault', () => {
  const permit = (holder: string, expiresOn: string | null, extra: Record<string, unknown> = {}) => ({
    tenant_id: TENANT_A, holder_of_record: holder, expires_on: expiresOn, renewal_application_due_on: null,
    renewal_submitted_on: null, retired_at: null, ...extra,
  })

  it('counts active permits past their renewal deadline, and those naming a holder other than the scope in force', async () => {
    seed('ms_scope_statements', [
      { tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'Northfield Metal Products Inc.', effective_from: '2020-01-01', next_review_due: FUTURE, control_and_influence: null },
      { tenant_id: TENANT_A, discipline: 'ems', version: 2, legal_entity: 'Northfield Forge & Finish LLC', effective_from: '2025-01-01', next_review_due: FUTURE, control_and_influence: null },
    ])
    seed('environmental_permits', [
      permit('Northfield Forge & Finish, LLC', FUTURE),
      permit('Northfield Forge & Finish LLC', PAST),
      permit('Northfield Forge & Finish LLC', PAST, { renewal_submitted_on: '2025-11-01' }),
      permit('Northfield Forge & Finish LLC', FUTURE, { renewal_application_due_on: PAST }),
      permit('Northfield Metal Products Inc.', FUTURE),
      permit('Northfield Metal Products Inc.', PAST, { retired_at: '2026-02-01T00:00:00Z' }),
      { ...permit('Northfield Metal Products Inc.', PAST), tenant_id: TENANT_B },
    ])
    expect(await signals()).toMatchObject({ permitsDeadlineMissed: 2, permitsHolderMismatch: 1 })
  })

  it('flags no holder when no scope is recorded to compare against', async () => {
    seed('environmental_permits', [permit('Anyone at all', FUTURE)])
    expect(await signals()).toMatchObject({ permitsDeadlineMissed: 0, permitsHolderMismatch: 0 })
  })
})

describe('fetchIso14001Signals — safety records are not environmental evidence', () => {
  it('leaves 7.2 to 8.2 not assessed however many safety records the tenant keeps', async () => {
    // These clauses once graded from exactly these tables, which an auditor would not accept as environmental evidence.
    seed('loto_training_records', [{ tenant_id: TENANT_A, expires_at: FUTURE }])
    seed('toolbox_talks', [{ tenant_id: TENANT_A, talk_date: '2026-09-30' }])
    seed('prop65_notifications', [{ tenant_id: TENANT_A, notified_at: '2026-09-30T00:00:00Z' }])
    seed('inspections', [{ id: 'i1', tenant_id: TENANT_A, status: 'submitted', submitted_at: '2026-09-30T00:00:00Z' }])

    const card = assessIso14001(await signals())
    const verdicts = Object.fromEntries(card.clauses.map(c => [c.code, c.verdict]))
    expect(verdicts).toMatchObject({
      '7.2': 'not_assessed', '7.3': 'not_assessed', '7.4': 'not_assessed', '8.1': 'not_assessed', '8.2': 'not_assessed',
    })
  })
})

describe('fetchIso14001Signals — Phase 1.1 facts', () => {
  const policy = (id: string, version: number, signedAt: string) => ({
    id, tenant_id: TENANT_A, discipline: 'ems', version, commitments: COMPLETE, signatory_name: 'Plant Manager',
    signed_at: signedAt, next_review_due: FUTURE,
  })

  it('counts only an internal communication of the policy in force', async () => {
    seed('ms_policies', [policy('p1', 1, '2025-01-01'), policy('p2', 2, '2026-03-01')])
    seed('ms_policy_communications', [
      { tenant_id: TENANT_A, discipline: 'ems', policy_id: 'p1', audience: 'internal' },
      { tenant_id: TENANT_A, discipline: 'ems', policy_id: 'p2', audience: 'external' },
    ])
    expect((await signals()).policyCommunicatedInternally).toBe(false)
    seed('ms_policy_communications', [{ tenant_id: TENANT_A, discipline: 'ems', policy_id: 'p2', audience: 'internal' }])
    expect((await signals()).policyCommunicatedInternally).toBe(true)
  })

  it('reads the scope\'s control-and-influence statement, the undecided aspects and the responsibilities held', async () => {
    seed('ms_scope_statements', [{ tenant_id: TENANT_A, discipline: 'ems', version: 1, legal_entity: 'A', effective_from: '2026-01-01', next_review_due: FUTURE, control_and_influence: null }])
    seed('environmental_aspects', [
      { id: 'a1', tenant_id: TENANT_A, obsolete_at: null, next_review_due: FUTURE, control_level: 'influence' },
      { id: 'a2', tenant_id: TENANT_A, obsolete_at: null, next_review_due: FUTURE, control_level: null },
    ])
    seed('ms_responsibilities', [
      { tenant_id: TENANT_A, discipline: 'ems', responsibility_key: 'system_conformity', owner_user_id: 'u1' },
      { tenant_id: TENANT_A, discipline: 'ems', responsibility_key: 'aspects', owner_user_id: null },
      { tenant_id: TENANT_B, discipline: 'ems', responsibility_key: 'performance_reporting', owner_user_id: 'u2' },
    ])
    expect(await signals()).toMatchObject({
      scopeStatesControlAndInfluence: false, aspectsControlUndetermined: 1, rolesUnassigned: 1, processesUnassigned: 15,
    })
  })

  it('surfaces a failed register read instead of grading it as nothing recorded', async () => {
    failNext('ms_scope_statements', { code: '42703', message: 'column ms_scope_statements.control_and_influence does not exist' })
    await expect(signals()).rejects.toThrow(/control_and_influence does not exist/)
  })
})
