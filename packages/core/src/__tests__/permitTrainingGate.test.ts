import { describe, expect, it } from 'vitest'
import {
  parseTrainingRequiredError,
  summarizePermitTraining,
  validateOverrideReason,
  type PermitTrainingStatusRow,
} from '../permitTrainingGate'

function row(member: string, name: string, module: string, status: PermitTrainingStatusRow['status']): PermitTrainingStatusRow {
  return { member_id: member, display_name: name, module_id: module, module_title: `Module ${module}`, status, expires_at: null }
}

describe('summarizePermitTraining', () => {
  it('treats a permit type with no requirements as ungated and ready', () => {
    expect(summarizePermitTraining([])).toEqual({ gated: false, ready: true, crew: [], missingMemberIds: [], overriddenCount: 0 })
  })

  it('is not ready while any crew member is missing any module, and lists them first', () => {
    const summary = summarizePermitTraining([
      row('m1', 'Ana', 'loto', 'current'),
      row('m2', 'Ben', 'loto', 'current'),
      row('m2', 'Ben', 'cse', 'missing'),
    ])
    expect(summary.ready).toBe(false)
    expect(summary.missingMemberIds).toEqual(['m2'])
    expect(summary.crew.map(c => c.displayName)).toEqual(['Ben', 'Ana'])
    expect(summary.crew[0].modules).toHaveLength(2)
  })

  it('counts an overridden worker as ready but reports the override', () => {
    const summary = summarizePermitTraining([row('m1', 'Ana', 'loto', 'overridden')])
    expect(summary.ready).toBe(true)
    expect(summary.overriddenCount).toBe(1)
  })
})

describe('parseTrainingRequiredError', () => {
  it('extracts the detail from the gate exception', () => {
    expect(parseTrainingRequiredError('TRAINING_REQUIRED: required training is missing for Ana — LOTO 101'))
      .toBe('Required training is missing for Ana — LOTO 101')
  })

  it('returns null for unrelated errors', () => {
    expect(parseTrainingRequiredError('duplicate key value violates unique constraint')).toBeNull()
    expect(parseTrainingRequiredError(null)).toBeNull()
  })
})

describe('validateOverrideReason', () => {
  it('requires a real explanation', () => {
    expect(validateOverrideReason('   urgent    ')).toMatch(/at least 20/)
    expect(validateOverrideReason('Ammonia leak response; trained crew unavailable on site.')).toBeNull()
  })
})
