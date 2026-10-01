import { describe, it, expect } from 'vitest'
import {
  EVALUATION_LEAD_DAYS,
  evaluationCompletionGaps,
  evaluationsToSchedule,
  formatJurisdiction,
  parseJurisdiction,
  validateObligationRegisterInput,
  type ObligationRegisterInput,
  type SchedulableObligation,
} from '../complianceEvaluation'

const TODAY = '2026-10-01'

describe('parseJurisdiction', () => {
  it('parses the three accepted forms', () => {
    expect(parseJurisdiction('federal')).toEqual({ level: 'federal' })
    expect(parseJurisdiction('state:TX')).toEqual({ level: 'state', state: 'TX' })
    expect(parseJurisdiction('local:Northfield County')).toEqual({ level: 'local', name: 'Northfield County' })
  })

  it('rejects a lower-case state code (the database check is case-sensitive too)', () => {
    expect(parseJurisdiction('state:tx')).toBeNull()
  })

  it('rejects malformed values', () => {
    for (const raw of ['', 'Federal', 'state:TEX', 'state:', 'local:', 'local:   ', 'county:Harris']) {
      expect(parseJurisdiction(raw), raw).toBeNull()
    }
  })

  it('formats for display', () => {
    expect(formatJurisdiction({ level: 'state', state: 'TX' })).toBe('State (TX)')
    expect(formatJurisdiction({ level: 'federal' })).toBe('Federal')
  })
})

describe('evaluationsToSchedule', () => {
  const obligation = (id: string, cadence: number | null = 365, active = true): SchedulableObligation =>
    ({ id, evaluationCadenceDays: cadence, active })

  it('schedules a never-evaluated obligation for today', () => {
    expect(evaluationsToSchedule([obligation('o1')], [], TODAY)).toEqual([{ obligationId: 'o1', scheduledFor: TODAY }])
  })

  it('schedules when the next evaluation falls due exactly at the lead-time horizon', () => {
    // Last evaluated 335 days ago with a 365-day cadence: due in exactly 30 days.
    const completedAt = '2025-10-31T09:00:00Z'
    expect(EVALUATION_LEAD_DAYS).toBe(30)
    expect(evaluationsToSchedule([obligation('o1')], [{ obligationId: 'o1', completedAt }], TODAY))
      .toEqual([{ obligationId: 'o1', scheduledFor: '2026-10-31' }])
  })

  it('does not schedule when the evaluation falls due one day past the horizon', () => {
    const completedAt = '2025-11-01T09:00:00Z'   // due 2026-11-01, 31 days out
    expect(evaluationsToSchedule([obligation('o1')], [{ obligationId: 'o1', completedAt }], TODAY)).toEqual([])
  })

  it('schedules an overdue evaluation with its original due date', () => {
    const completedAt = '2025-01-15T09:00:00Z'
    expect(evaluationsToSchedule([obligation('o1')], [{ obligationId: 'o1', completedAt }], TODAY))
      .toEqual([{ obligationId: 'o1', scheduledFor: '2026-01-15' }])
  })

  it('never double-books: an open evaluation blocks a new one', () => {
    expect(evaluationsToSchedule([obligation('o1')], [{ obligationId: 'o1', completedAt: null }], TODAY)).toEqual([])
  })

  it('counts from the latest completed evaluation, whatever the input order', () => {
    const evaluations = [
      { obligationId: 'o1', completedAt: '2026-09-01T00:00:00Z' },
      { obligationId: 'o1', completedAt: '2024-01-01T00:00:00Z' },
    ]
    // 2026-09-01 + 30 days = today; counting from 2024 would give 2024-01-31 instead.
    expect(evaluationsToSchedule([obligation('o1', 30)], evaluations, TODAY))
      .toEqual([{ obligationId: 'o1', scheduledFor: TODAY }])
  })

  it('skips obligations with no evaluation cadence, and inactive ones', () => {
    expect(evaluationsToSchedule([obligation('o1', null), obligation('o2', 365, false)], [], TODAY)).toEqual([])
  })

  it('treats each obligation independently', () => {
    const result = evaluationsToSchedule(
      [obligation('o1'), obligation('o2')],
      [{ obligationId: 'o2', completedAt: null }],
      TODAY,
    )
    expect(result).toEqual([{ obligationId: 'o1', scheduledFor: TODAY }])
  })
})

describe('evaluationCompletionGaps', () => {
  it('requires a result first', () => {
    expect(evaluationCompletionGaps({ result: null, evidenceCount: 3, notes: 'x' })).toEqual(['result_required'])
  })

  it('requires evidence for compliant and noncompliant results', () => {
    expect(evaluationCompletionGaps({ result: 'compliant', evidenceCount: 0, notes: null })).toEqual(['evidence_required'])
    expect(evaluationCompletionGaps({ result: 'noncompliant', evidenceCount: 0, notes: null })).toEqual(['evidence_required'])
    expect(evaluationCompletionGaps({ result: 'compliant', evidenceCount: 1, notes: null })).toEqual([])
  })

  it('requires notes, not evidence, for not applicable', () => {
    expect(evaluationCompletionGaps({ result: 'not_applicable', evidenceCount: 0, notes: '  ' })).toEqual(['notes_required'])
    expect(evaluationCompletionGaps({ result: 'not_applicable', evidenceCount: 0, notes: 'Process retired.' })).toEqual([])
  })

  it('lets an undetermined result close without evidence', () => {
    expect(evaluationCompletionGaps({ result: 'undetermined', evidenceCount: 0, notes: null })).toEqual([])
  })
})

describe('validateObligationRegisterInput', () => {
  const valid: ObligationRegisterInput = {
    title: 'Air permit: annual emissions inventory', sourceKind: 'permit', citation: 'Permit O-1234',
    jurisdiction: 'state:TX', applicabilityRationale: 'The site operates two permitted boilers.', evaluationCadenceDays: 365,
  }
  const fields = (input: ObligationRegisterInput) => validateObligationRegisterInput(input).map(e => e.field)

  it('accepts a complete obligation', () => {
    expect(validateObligationRegisterInput(valid)).toEqual([])
  })

  it('requires a title and a known source kind', () => {
    expect(fields({ ...valid, title: '  ' })).toEqual(['title'])
    expect(fields({ ...valid, sourceKind: 'rumour' as ObligationRegisterInput['sourceKind'] })).toEqual(['sourceKind'])
  })

  it('rejects a malformed jurisdiction', () => {
    expect(fields({ ...valid, jurisdiction: 'Texas' })).toEqual(['jurisdiction'])
  })

  it('bounds the evaluation cadence, and allows none', () => {
    expect(fields({ ...valid, evaluationCadenceDays: null })).toEqual([])
    expect(fields({ ...valid, evaluationCadenceDays: 0 })).toEqual(['evaluationCadenceDays'])
    expect(fields({ ...valid, evaluationCadenceDays: 3650 })).toEqual([])
    expect(fields({ ...valid, evaluationCadenceDays: 3651 })).toEqual(['evaluationCadenceDays'])
    expect(fields({ ...valid, evaluationCadenceDays: 30.5 })).toEqual(['evaluationCadenceDays'])
  })
})
