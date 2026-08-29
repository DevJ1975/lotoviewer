import { describe, it, expect } from 'vitest'
import {
  strongestControlLevel,
  validateMethodStatement,
  type MethodStatement,
  type MethodStatementStep,
} from '../methodStatement'

// A method statement is handed to a crew and to a principal contractor. The
// completeness rules here are what stops an AI first draft reaching either one
// with a step nobody owns or no answer for when it goes wrong.

const step = (over: Partial<MethodStatementStep> = {}): MethodStatementStep => ({
  sequence:        1,
  description:     'Isolate the drive motor at the local disconnect.',
  hazards:         ['Stored electrical energy'],
  controls:        [{ description: 'Lockout applied and verified', hierarchyLevel: 'engineering' }],
  responsibleRole: 'Authorized employee',
  ...over,
})

const statement = (over: Partial<MethodStatement> = {}): MethodStatement => ({
  title:        'Replacing the mixer drive belt',
  jurisdiction: 'US-CA',
  scope:        'Covers belt replacement on the No. 2 mixer. Does not cover gearbox work.',
  location:     'Plant 1, mixing room',
  steps:        [step()],
  ppe:          ['Cut-resistant gloves'],
  plantAndEquipment: ['Lockout kit'],
  competencies: ['LOTO authorized employee'],
  emergencyArrangements: 'Stop work, call the shift lead on extension 200, first aid at the north station.',
  ...over,
})

describe('a complete method statement', () => {
  it('passes with no blocking issues', () => {
    const result = validateMethodStatement(statement())
    expect(result.ok).toBe(true)
    expect(result.issues.filter(i => i.severity === 'blocking')).toEqual([])
  })
})

describe('blocking omissions', () => {
  const blockingPaths = (ms: MethodStatement) =>
    validateMethodStatement(ms).issues.filter(i => i.severity === 'blocking').map(i => i.path)

  it('refuses a job with no emergency arrangements', () => {
    // The crew needs an answer for when it goes wrong before they start.
    const result = validateMethodStatement(statement({ emergencyArrangements: '' }))
    expect(result.ok).toBe(false)
    expect(blockingPaths(statement({ emergencyArrangements: '' }))).toContain('emergencyArrangements')
  })

  it('refuses a step nobody is accountable for', () => {
    expect(blockingPaths(statement({ steps: [step({ responsibleRole: '' })] })))
      .toContain('steps.0.responsibleRole')
  })

  it('refuses a step that names hazards but applies no controls', () => {
    expect(blockingPaths(statement({ steps: [step({ controls: [] })] })))
      .toContain('steps.0.controls')
  })

  it('refuses a thin scope that does not say what is excluded', () => {
    expect(blockingPaths(statement({ scope: 'Belt work.' }))).toContain('scope')
  })

  it('refuses a missing jurisdiction — mandatory sections differ by regime', () => {
    expect(blockingPaths(statement({ jurisdiction: '' }))).toContain('jurisdiction')
  })

  it('refuses a document with no steps', () => {
    expect(blockingPaths(statement({ steps: [] }))).toContain('steps')
  })

  it('refuses an ambiguous sequence', () => {
    const dup = statement({ steps: [step({ sequence: 1 }), step({ sequence: 1 })] })
    expect(blockingPaths(dup)).toContain('steps.1.sequence')
  })
})

describe('advisory findings', () => {
  const advisories = (ms: MethodStatement) =>
    validateMethodStatement(ms).issues.filter(i => i.severity === 'advisory')

  it('flags PPE-only control without blocking the document', () => {
    // ISO 45001 8.1.2 puts PPE last, but there are real steps where it is all
    // that is left. Blocking here would train reviewers to bypass the check.
    const ppeOnly = statement({
      steps: [step({ controls: [{ description: 'Wear gloves', hierarchyLevel: 'ppe' }] })],
    })
    const result = validateMethodStatement(ppeOnly)
    expect(result.ok).toBe(true)
    expect(advisories(ppeOnly).map(i => i.path)).toContain('steps.0.controls')
  })

  it('does not flag PPE when a stronger control is also applied', () => {
    const mixed = statement({
      steps: [step({ controls: [
        { description: 'Wear gloves',      hierarchyLevel: 'ppe' },
        { description: 'Guard interlock',  hierarchyLevel: 'engineering' },
      ] })],
    })
    expect(advisories(mixed).map(i => i.path)).not.toContain('steps.0.controls')
  })

  it('flags a hazard-free step as unexamined rather than accepting it silently', () => {
    const benign = statement({ steps: [step({ hazards: [], controls: [] })] })
    const result = validateMethodStatement(benign)
    expect(result.ok).toBe(true)
    expect(advisories(benign).map(i => i.path)).toContain('steps.0.hazards')
  })

  it('flags an empty competency list', () => {
    expect(advisories(statement({ competencies: [] })).map(i => i.path)).toContain('competencies')
  })
})

describe('strongestControlLevel', () => {
  it('reports the most effective control applied anywhere in the job', () => {
    const ms = statement({ steps: [
      step({ controls: [{ description: 'Wear gloves', hierarchyLevel: 'ppe' }] }),
      step({ sequence: 2, controls: [{ description: 'Design out the pinch point', hierarchyLevel: 'elimination' }] }),
    ] })
    expect(strongestControlLevel(ms)).toBe('elimination')
  })

  it('returns null when no step applies a control', () => {
    expect(strongestControlLevel(statement({ steps: [step({ hazards: [], controls: [] })] }))).toBeNull()
  })
})
