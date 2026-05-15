import { describe, it, expect } from 'vitest'
import {
  validateProcedure,
  groupStepsByPhase,
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
      'release_stored_energy',
      'lockout',
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

  it('returns missing phases in OSHA documentation order', () => {
    const result = validateProcedure([step('lockout', 1)])
    expect(result.missing).toEqual([
      'isolate',
      'release_stored_energy',
      'verify_zero_energy',
    ])
  })
})

describe('groupStepsByPhase', () => {
  it('groups steps in OSHA order and sorts within each phase by sequence_order', () => {
    const grouped = groupStepsByPhase([
      step('lockout', 2),
      step('isolate', 1),
      step('verify_zero_energy', 4),
      step('release_stored_energy', 3),
      step('isolate', 5),
    ])
    expect(grouped.map(g => g.phase)).toEqual([
      'isolate',
      'release_stored_energy',
      'lockout',
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
})

describe('LOTO_STEP_ORDER', () => {
  it('matches §1910.147(c)(4)(ii) documentation order', () => {
    // The placard renderer relies on this exact order; lock it in.
    expect(LOTO_STEP_ORDER).toEqual([
      'shutdown',
      'isolate',
      'release_stored_energy',
      'lockout',
      'verify_zero_energy',
    ])
  })
})
