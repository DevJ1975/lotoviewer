import { describe, it, expect } from 'vitest'
import {
  CARVE_OUT_ACTIONS,
  ALL_CARVE_OUT_ACTIONS,
  authorizingRoleFor,
  isReversibleAction,
  isCarveOutAction,
  AGENT_ACTION_STATUSES,
  canTransition,
  isTerminalAgentActionStatus,
} from '@soteria/core/operatorActions'

describe('carve-out action registry', () => {
  it('every action has a well-formed spec', () => {
    for (const action of ALL_CARVE_OUT_ACTIONS) {
      const spec = CARVE_OUT_ACTIONS[action]
      expect(spec.action).toBe(action)
      expect(['admin', 'owner']).toContain(spec.authorizingRole)
      expect(typeof spec.reversible).toBe('boolean')
      expect(spec.label.length).toBeGreaterThan(0)
    }
  })

  it('OSHA executive actions require owner-level authorization', () => {
    expect(authorizingRoleFor('osha_300a_cert')).toBe('owner')
    expect(authorizingRoleFor('osha_ita_submit')).toBe('owner')
  })

  it('an ITA submission is irreversible; a LOTO certification is reversible', () => {
    expect(isReversibleAction('osha_ita_submit')).toBe(false)
    expect(isReversibleAction('loto_zero_energy_cert')).toBe(true)
  })

  it('isCarveOutAction narrows only known actions', () => {
    expect(isCarveOutAction('permit_hot_work_auth')).toBe(true)
    expect(isCarveOutAction('delete_everything')).toBe(false)
  })
})

describe('staged-action lifecycle', () => {
  it('enumerates exactly the four lifecycle states', () => {
    expect([...AGENT_ACTION_STATUSES]).toEqual(['pending', 'applied', 'rejected', 'rolled_back'])
  })

  it('allows one-tap pending → applied | rejected', () => {
    expect(canTransition('pending', 'applied')).toBe(true)
    expect(canTransition('pending', 'rejected')).toBe(true)
  })

  it('forbids skipping or reviving terminal states', () => {
    expect(canTransition('rejected', 'applied')).toBe(false)
    expect(canTransition('applied', 'rejected')).toBe(false)
    expect(canTransition('rolled_back', 'applied')).toBe(false)
    expect(canTransition('pending', 'rolled_back')).toBe(false)
  })

  it('gates applied → rolled_back on reversibility', () => {
    expect(canTransition('applied', 'rolled_back')).toBe(true)
    expect(canTransition('applied', 'rolled_back', { reversible: true })).toBe(true)
    expect(canTransition('applied', 'rolled_back', { reversible: false })).toBe(false)
  })

  it('marks rejected and rolled_back as terminal', () => {
    expect(isTerminalAgentActionStatus('rejected')).toBe(true)
    expect(isTerminalAgentActionStatus('rolled_back')).toBe(true)
    expect(isTerminalAgentActionStatus('pending')).toBe(false)
    expect(isTerminalAgentActionStatus('applied')).toBe(false)
  })
})
