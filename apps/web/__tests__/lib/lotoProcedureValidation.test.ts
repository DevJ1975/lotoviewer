import { describe, it, expect } from 'vitest'
import {
  validateProcedure,
  groupStepsByPhase,
  prerequisiteCount,
  LOTO_STEP_ORDER,
  type LotoStepType,
} from '@soteria/core/lotoProcedureValidation'

function step(step_type: LotoStepType, sequence_order = 1) {
  return { step_type, sequence_order }
}

describe('validateProcedure', () => {
  it('passes when every required phase is represented', () => {
    const result = validateProcedure([
      step('isolate', 1),
      step('release_stored_energy', 2),
      step('lockout', 3),
      step('verify_zero_energy', 4),
    ])
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('passes with shutdown step included (shutdown is optional)', () => {
    const result = validateProcedure([
      step('shutdown', 1),
      step('isolate', 2),
      step('release_stored_energy', 3),
      step('lockout', 4),
      step('verify_zero_energy', 5),
    ])
    expect(result.valid).toBe(true)
  })

  it('fails when verify_zero_energy is missing — the §147(d)(6) tryout block', () => {
    const result = validateProcedure([
      step('isolate', 1),
      step('release_stored_energy', 2),
      step('lockout', 3),
    ])
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('verify_zero_energy')
  })

  it('fails on an empty procedure and lists every required phase', () => {
    const result = validateProcedure([])
    expect(result.valid).toBe(false)
    expect(result.missing).toEqual([
      'isolate',
      'lockout',
      'release_stored_energy',
      'verify_zero_energy',
    ])
  })

  it('does not double-count when a phase appears multiple times', () => {
    // A multi-disconnect machine — two isolate steps is fine.
    const result = validateProcedure([
      step('isolate', 1),
      step('isolate', 2),
      step('release_stored_energy', 3),
      step('lockout', 4),
      step('verify_zero_energy', 5),
    ])
    expect(result.valid).toBe(true)
  })

  it('returns missing phases in §147(d) application order', () => {
    const result = validateProcedure([step('isolate', 1)])
    expect(result.missing).toEqual([
      'lockout',
      'release_stored_energy',
      'verify_zero_energy',
    ])
  })
})

describe('groupStepsByPhase', () => {
  it('groups steps in OSHA order and sorts within each phase by sequence_order', () => {
    const grouped = groupStepsByPhase([
      step('release_stored_energy', 3),
      step('isolate', 1),
      step('verify_zero_energy', 4),
      step('lockout', 2),
      step('isolate', 5),
    ])
    expect(grouped.map(g => g.phase)).toEqual([
      'isolate',
      'lockout',
      'release_stored_energy',
      'verify_zero_energy',
    ])
    const isolate = grouped.find(g => g.phase === 'isolate')!
    expect(isolate.steps.map(s => s.sequence_order)).toEqual([1, 5])
  })

  it('omits phases that have no steps', () => {
    const grouped = groupStepsByPhase([step('verify_zero_energy', 1)])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].phase).toBe('verify_zero_energy')
  })

  it('places lockout before release of stored energy — §147(d)(4) then (d)(5)(i)', () => {
    // Keyed in the old order; the placard must still print locks first.
    const grouped = groupStepsByPhase([
      step('release_stored_energy', 1),
      step('lockout', 2),
    ])
    expect(grouped.map(g => g.phase)).toEqual(['lockout', 'release_stored_energy'])
  })

  it('breaks a sequence_order tie with step_number', () => {
    const grouped = groupStepsByPhase([
      { step_type: 'isolate' as const, sequence_order: 1, step_number: 3 },
      { step_type: 'isolate' as const, sequence_order: 1, step_number: 1 },
      { step_type: 'isolate' as const, sequence_order: 1, step_number: 2 },
    ])
    expect(grouped[0].steps.map(s => s.step_number)).toEqual([1, 2, 3])
  })

  it('breaks a full tie by printing a step after the isolations it names', () => {
    // Every step numbered 1 — the placard that printed "After electrical
    // isolation" above the electrical step itself.
    const tied = (id: string, isolation_procedure: string) => ({
      id, step_type: 'isolate' as const, sequence_order: 1, step_number: 1, isolation_procedure,
    })
    const grouped = groupStepsByPhase([
      tied('gravity', 'After electrical and pneumatic isolation, pin the carriage.'),
      tied('pneumatic', 'After electrical isolation per the E procedure, close valve V-2.'),
      tied('electrical', 'Open disconnect DS-1 and apply lock.'),
    ])
    expect(grouped[0].steps.map(s => s.id)).toEqual(['electrical', 'pneumatic', 'gravity'])
  })

  it('lets sequence_order outrank the prerequisite tie-break', () => {
    const grouped = groupStepsByPhase([
      { id: 'a', step_type: 'isolate' as const, sequence_order: 1, isolation_procedure: 'After electrical isolation, bleed.' },
      { id: 'b', step_type: 'isolate' as const, sequence_order: 2, isolation_procedure: 'Open disconnect.' },
    ])
    expect(grouped[0].steps.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('keeps input order when every key ties (stable sort)', () => {
    const grouped = groupStepsByPhase([
      { id: 'first',  step_type: 'lockout' as const, sequence_order: 1 },
      { id: 'second', step_type: 'lockout' as const, sequence_order: 1 },
    ])
    expect(grouped[0].steps.map(s => s.id)).toEqual(['first', 'second'])
  })
})

describe('prerequisiteCount', () => {
  it.each([
    ['Open disconnect DS-1 and apply lock.',                        0],
    ['After electrical isolation per the E procedure, close V-2.',   1],
    ['after Electrical Isolation, bleed the line.',                  1],
    ['After electrical and pneumatic isolation, pin the carriage.',  2],
    ['After electrical, pneumatic & hydraulic isolation, block.',    3],
    ['After electrical/pneumatic isolation, block.',                 2],
  ])('%s → %i', (isolation_procedure, expected) => {
    expect(prerequisiteCount({ isolation_procedure })).toBe(expected)
  })

  it('treats a missing procedure as no prerequisites', () => {
    expect(prerequisiteCount({ isolation_procedure: null })).toBe(0)
    expect(prerequisiteCount({})).toBe(0)
  })
})

describe('LOTO_STEP_ORDER', () => {
  it('matches the §1910.147(d) application order — lockout before stored-energy release', () => {
    // The placard renderer relies on this exact order; lock it in.
    expect(LOTO_STEP_ORDER).toEqual([
      'shutdown',
      'isolate',
      'lockout',
      'release_stored_energy',
      'verify_zero_energy',
    ])
  })
})
