import { describe, it, expect } from 'vitest'
import {
  EMS_RESPONSIBILITIES,
  RESPONSIBILITY_KEYS,
  isResponsibilityKey,
  responsibilitiesHealth,
  responsibilityCoverage,
} from '../emsProcesses'

describe('EMS_RESPONSIBILITIES — the clause 4.4 map', () => {
  it('lists every key exactly once, in the same order as RESPONSIBILITY_KEYS', () => {
    // RESPONSIBILITY_KEYS is migration 302's check list; the two must not drift.
    expect(EMS_RESPONSIBILITIES.map(r => r.key)).toEqual([...RESPONSIBILITY_KEYS])
  })

  it('carries the two roles clause 5.3 a) and b) assign', () => {
    const roles = EMS_RESPONSIBILITIES.filter(r => r.kind === 'role')
    expect(roles.map(r => r.clauses)).toEqual([['5.3 a)'], ['5.3 b)']])
  })

  it('only ever feeds processes that are on the map, and never itself', () => {
    const processes = new Set(EMS_RESPONSIBILITIES.filter(r => r.kind === 'process').map(r => r.key))
    for (const r of EMS_RESPONSIBILITIES) {
      for (const fed of r.feeds) {
        expect(processes.has(fed), `${r.key} feeds ${fed}`).toBe(true)
        expect(fed).not.toBe(r.key)
      }
    }
  })

  it('links in-platform processes to an app route and leaves the rest without one', () => {
    for (const r of EMS_RESPONSIBILITIES) {
      if (r.href !== null) expect(r.href).toMatch(/^\/environmental\//)
    }
    const offPlatform = EMS_RESPONSIBILITIES.filter(r => r.kind === 'process' && r.href === null).map(r => r.key)
    expect(offPlatform).toEqual([
      'competence_awareness', 'communication', 'documented_information', 'operational_control',
      'emergency_preparedness', 'internal_audit',
    ])
  })
})

describe('isResponsibilityKey', () => {
  it('accepts the map\'s keys and nothing else', () => {
    expect(isResponsibilityKey('aspects')).toBe(true)
    expect(isResponsibilityKey('coffee_rota')).toBe(false)
  })
})

describe('responsibilityCoverage and responsibilitiesHealth', () => {
  const everything = new Set<string>(RESPONSIBILITY_KEYS)

  it('is green when every role and process has an owner', () => {
    const coverage = responsibilityCoverage(everything)
    expect(coverage).toEqual({ rolesUnassigned: 0, processesUnassigned: 0 })
    expect(responsibilitiesHealth(coverage)).toBe('green')
  })

  it('is red while a clause 5.3 role has no one, however many processes do', () => {
    const coverage = responsibilityCoverage(new Set([...everything].filter(k => k !== 'performance_reporting')))
    expect(coverage).toEqual({ rolesUnassigned: 1, processesUnassigned: 0 })
    expect(responsibilitiesHealth(coverage)).toBe('red')
  })

  it('is amber while only processes lack an owner', () => {
    const coverage = responsibilityCoverage(new Set([...everything].filter(k => k !== 'aspects' && k !== 'policy')))
    expect(coverage).toEqual({ rolesUnassigned: 0, processesUnassigned: 2 })
    expect(responsibilitiesHealth(coverage)).toBe('amber')
  })

  it('counts every responsibility as open for a tenant that has assigned none', () => {
    expect(responsibilityCoverage(new Set())).toEqual({ rolesUnassigned: 2, processesUnassigned: 14 })
  })

  it('ignores keys that are not on the map', () => {
    expect(responsibilityCoverage(new Set(['coffee_rota']))).toEqual({ rolesUnassigned: 2, processesUnassigned: 14 })
  })
})
