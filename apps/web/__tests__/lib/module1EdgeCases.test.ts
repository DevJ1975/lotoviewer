// Phase-D edge-case tests for Module 1 helpers. Covers boundaries the
// happy-path suites don't exercise: degenerate inputs, timezone-naive
// dates, off-by-one window edges, and a few "garbage in" defensive
// paths that protect the production audit trail when the DB returns
// data that bypassed the TS types (jsonb).

import { describe, it, expect } from 'vitest'
import { validateProcedure, groupStepsByPhase, type LotoStepType } from '@soteria/core/lotoProcedureValidation'
import { classifyPeriodic, computeNextDueAt } from '@soteria/core/lotoPeriodicInspection'
import { scoreAttempt, validateQuestions } from '@soteria/core/lotoCompetencyExam'
import { classifyInsurance, buildContractorInsuranceDigest } from '@soteria/core/contractorCompliance'
import { canClosePermit, canAddMember } from '@soteria/core/lotoGroupPermit'
import { checklistCompletion, defaultWalkdownItems, type WalkdownItem } from '@soteria/core/lotoWalkdownChecklist'

const ASOF = new Date('2026-05-15T00:00:00Z')

describe('lotoProcedureValidation — boundary inputs', () => {
  it('handles a 200-step procedure (high-cycle equipment with many isolations)', () => {
    const steps: { step_type: LotoStepType; sequence_order: number }[] = Array.from(
      { length: 200 },
      (_, i) => ({ step_type: 'isolate', sequence_order: i + 1 }),
    )
    steps.push({ step_type: 'release_stored_energy', sequence_order: 201 })
    steps.push({ step_type: 'lockout',               sequence_order: 202 })
    steps.push({ step_type: 'verify_zero_energy',    sequence_order: 203 })
    expect(validateProcedure(steps).valid).toBe(true)
    const grouped = groupStepsByPhase(steps)
    expect(grouped[0].steps).toHaveLength(200)
  })

  it('groupStepsByPhase preserves negative sequence_order ordering deterministically', () => {
    const grouped = groupStepsByPhase([
      { step_type: 'isolate', sequence_order: -5 },
      { step_type: 'isolate', sequence_order: 0 },
      { step_type: 'isolate', sequence_order: 3 },
    ])
    expect(grouped[0].steps.map(s => s.sequence_order)).toEqual([-5, 0, 3])
  })
})

describe('lotoPeriodicInspection — timezone and date boundaries', () => {
  it('classifies a date-only string (no timezone) without crashing', () => {
    // The DB stores timestamptz, but if the API returns a date without
    // timezone in some serialization path, we should still classify it.
    const r = classifyPeriodic('2026-05-29', ASOF)
    expect(['due_soon', 'overdue', 'current']).toContain(r)
  })

  it('classifies an ISO date with explicit offset', () => {
    // -0500 means later in UTC than appears
    expect(classifyPeriodic('2025-01-01T00:00:00-05:00', ASOF)).toBe('overdue')
  })

  it('computeNextDueAt over a leap-year boundary still adds exactly 365 days (not a calendar year)', () => {
    // 2028 is a leap year. We add 365 days, not "one year" — the DB
    // trigger does the same. Document the contract.
    const inspected = new Date('2027-03-01T00:00:00Z')
    const next = computeNextDueAt(inspected)
    expect(next.toISOString().slice(0, 10)).toBe('2028-02-29')
  })
})

describe('lotoCompetencyExam — scoring boundary values', () => {
  const q = [
    { prompt: 'Q1', choices: ['a', 'b'], answer_index: 0 },
    { prompt: 'Q2', choices: ['a', 'b'], answer_index: 1 },
  ]

  it('passing_score=0 passes any attempt (even all wrong)', () => {
    expect(scoreAttempt({ questions: q, passing_score: 0 }, [1, 0]).passed).toBe(true)
  })

  it('passing_score=100 requires perfection', () => {
    expect(scoreAttempt({ questions: q, passing_score: 100 }, [0, 1]).passed).toBe(true)
    expect(scoreAttempt({ questions: q, passing_score: 100 }, [0, 0]).passed).toBe(false)
  })

  it('treats a negative answer_index (common "unanswered" sentinel from the UI) as wrong', () => {
    const r = scoreAttempt({ questions: q, passing_score: 50 }, [-1, 1])
    expect(r.correct_count).toBe(1)
    expect(r.score).toBe(50)
  })

  it('validateQuestions flags a question whose choices include only whitespace duplicates', () => {
    const issues = validateQuestions([
      { prompt: 'p', choices: ['ok', '  ok  '], answer_index: 0 },
    ])
    expect(issues).toContainEqual({ index: 0, message: 'Choices must be distinct.' })
  })
})

describe('contractorCompliance — grace-window off-by-one', () => {
  it('a contractor expired 8 days ago (just past 7-day grace) is dropped from the digest', () => {
    const eightDaysAgo = new Date(ASOF.getTime() - 8 * 24 * 60 * 60 * 1000)
    const rows = buildContractorInsuranceDigest([{
      id: 'c-1', tenant_id: 't-1', name: 'Lapsed Co',
      contact_email: null, contact_phone: null,
      insurance_expires_at: eightDaysAgo.toISOString().slice(0, 10),
      host_procedures_acknowledged_at: null, host_acknowledged_by_user_id: null,
      notes: null, active: true,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    }], ASOF)
    expect(rows).toEqual([])
  })

  it('a contractor expiring on day 31 (one past the warning window) is "current", not "expiring"', () => {
    const day31 = new Date(ASOF.getTime() + 31 * 24 * 60 * 60 * 1000)
    expect(classifyInsurance(day31.toISOString().slice(0, 10), ASOF).status).toBe('current')
  })
})

describe('lotoGroupPermit — shift_handed_off transition', () => {
  it('shift_handed_off permits can be closed when no members are attached', () => {
    const r = canClosePermit({ status: 'shift_handed_off' }, [])
    expect(r.canClose).toBe(true)
  })

  it('shift_handed_off permits with active members cannot be closed', () => {
    const r = canClosePermit({ status: 'shift_handed_off' }, [{ left_at: null }])
    expect(r.canClose).toBe(false)
    expect(r.reason).toMatch(/1 member still attached/i)
  })

  it('canAddMember refuses a shift_handed_off permit with no primary set', () => {
    const r = canAddMember({ status: 'shift_handed_off', primary_authorized_employee_id: null })
    expect(r.canAdd).toBe(false)
  })
})

describe('lotoWalkdownChecklist — fail-without-notes guard', () => {
  it('a checklist with one fail and no notes blocks signoff', () => {
    const items = defaultWalkdownItems().map<WalkdownItem>((i, idx) =>
      idx === 0 ? { ...i, status: 'fail', notes: null } : { ...i, status: 'pass' },
    )
    const r = checklistCompletion(items)
    expect(r.complete).toBe(false)
    expect(r.fails_without_notes).toHaveLength(1)
  })

  it('a checklist with one fail + notes containing only whitespace still blocks signoff', () => {
    const items = defaultWalkdownItems().map<WalkdownItem>((i, idx) =>
      idx === 0 ? { ...i, status: 'fail', notes: '   ' } : { ...i, status: 'pass' },
    )
    expect(checklistCompletion(items).complete).toBe(false)
  })

  it('N/A items do not require notes (the N/A itself is the documentation)', () => {
    const items = defaultWalkdownItems().map<WalkdownItem>(i => ({ ...i, status: 'n_a' }))
    expect(checklistCompletion(items).complete).toBe(true)
  })
})
