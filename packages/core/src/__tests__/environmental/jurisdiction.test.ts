import { describe, it, expect } from 'vitest'
import {
  US_STATES, SUPPORTED_STATES, normalizeStateCode, stateName, isSupportedState,
  resolveJurisdiction, fallbackNotice,
} from '../../environmental/jurisdiction'

describe('normalizeStateCode', () => {
  it('accepts a USPS code in any case, with whitespace', () => {
    expect(normalizeStateCode('ca')).toBe('CA')
    expect(normalizeStateCode(' TX ')).toBe('TX')
  })

  it('accepts a full state name, any case', () => {
    expect(normalizeStateCode('California')).toBe('CA')
    expect(normalizeStateCode('new york')).toBe('NY')
    expect(normalizeStateCode('DISTRICT OF COLUMBIA')).toBe('DC')
  })

  it('rejects anything that is not a state', () => {
    for (const bad of ['', '  ', 'XX', 'Calif', 'USA', 'C', 'CAL', null, undefined]) {
      expect(normalizeStateCode(bad as string | null | undefined), String(bad)).toBeNull()
    }
  })

  it('knows all 50 states plus DC, each under a two-letter code', () => {
    expect(Object.keys(US_STATES)).toHaveLength(51)
    for (const code of Object.keys(US_STATES)) expect(code).toMatch(/^[A-Z]{2}$/)
  })
})

describe('stateName / isSupportedState', () => {
  it('names a state from a code or a name', () => {
    expect(stateName('tx')).toBe('Texas')
    expect(stateName(null)).toBeNull()
  })

  it('supports exactly the states that have a pack', () => {
    expect([...SUPPORTED_STATES].sort()).toEqual(['CA', 'TX'])
    expect(isSupportedState('ca')).toBe(true)
    expect(isSupportedState('Texas')).toBe(true)
    expect(isSupportedState('OR')).toBe(false)
    expect(isSupportedState(null)).toBe(false)
  })
})

describe('resolveJurisdiction', () => {
  it('layers a supported state on the federal baseline, federal first', () => {
    expect(resolveJurisdiction('CA')).toEqual({ chain: ['federal', 'CA'], state: 'CA', status: 'supported' })
    expect(resolveJurisdiction('texas')).toEqual({ chain: ['federal', 'TX'], state: 'TX', status: 'supported' })
  })

  it('falls back to federal only for a known state with no pack, and says so', () => {
    expect(resolveJurisdiction('OR')).toEqual({ chain: ['federal'], state: 'OR', status: 'unsupported' })
  })

  it('treats a missing or unrecognisable state as unset, not as unsupported', () => {
    for (const v of [null, undefined, '', 'Narnia']) {
      expect(resolveJurisdiction(v as string | null | undefined)).toEqual({ chain: ['federal'], state: null, status: 'unset' })
    }
  })
})

describe('fallbackNotice', () => {
  it('has nothing to say for a supported state', () => {
    expect(fallbackNotice(resolveJurisdiction('CA'))).toBeNull()
  })

  it('tells the reader the federal baseline is a reference, not the state rule, and names the state', () => {
    const text = fallbackNotice(resolveJurisdiction('OR'))!
    expect(text).toContain('Oregon')
    expect(text).toMatch(/federal baseline only/)
    expect(text).toMatch(/reference, not Oregon's rule/)
  })

  it('asks for a state when none is set', () => {
    expect(fallbackNotice(resolveJurisdiction(null))).toMatch(/No state is set/)
  })
})
