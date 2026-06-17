import { describe, it, expect } from 'vitest'
import {
  CARVE_OUT_ACTIONS,
  ALL_CARVE_OUT_ACTIONS,
  authorizingRoleFor,
  isReversibleAction,
  isCarveOutAction,
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
