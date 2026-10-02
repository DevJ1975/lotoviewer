// The environmental management system as a map of processes (ISO 14001
// clause 4.4: "the processes needed and their interactions"), plus the two
// roles clause 5.3 says top management must assign. A tenant assigns an
// owner to each one in ms_responsibilities (migration 302), whose check
// constraint lists these keys: adding one is a reviewed migration.
//
// Static, like the clause map in ./iso14001: which processes an EMS needs is
// a property of the standard, not of a tenant. Processes the platform keeps
// no record of yet still appear, with no screen, because the organization
// must run and own them all the same.

import type { RegisterHealth } from './managementSystem'

export const RESPONSIBILITY_KEYS = [
  'system_conformity', 'performance_reporting',
  'context', 'policy', 'aspects', 'obligations', 'objectives',
  'competence_awareness', 'communication', 'documented_information',
  'operational_control', 'emergency_preparedness',
  'compliance_evaluation', 'internal_audit', 'management_review', 'nonconformity',
] as const
export type ResponsibilityKey = typeof RESPONSIBILITY_KEYS[number]

export interface EmsResponsibility {
  key:     ResponsibilityKey
  /** A clause 5.3 role, or a process on the 4.4 map. */
  kind:    'role' | 'process'
  name:    string
  /** The ISO 14001:2015 clauses it answers. */
  clauses: readonly string[]
  /** The screen that runs it, or null while the platform keeps no record of it. */
  href:    string | null
  /** The processes this one's outputs feed: the map's interactions. */
  feeds:   readonly ResponsibilityKey[]
}

// In plan-do-check-act order, roles first.
export const EMS_RESPONSIBILITIES: readonly EmsResponsibility[] = [
  { key: 'system_conformity', kind: 'role', name: 'Ensuring the EMS conforms to ISO 14001',
    clauses: ['5.3 a)'], href: null, feeds: [] },
  { key: 'performance_reporting', kind: 'role', name: 'Reporting EMS performance to top management',
    clauses: ['5.3 b)'], href: null, feeds: [] },

  { key: 'context', kind: 'process', name: 'Context, interested parties and scope',
    clauses: ['4.1', '4.2', '4.3'], href: '/environmental/context', feeds: ['policy', 'aspects', 'obligations'] },
  { key: 'policy', kind: 'process', name: 'Environmental policy',
    clauses: ['5.2'], href: '/environmental/context?tab=policy', feeds: ['objectives', 'communication'] },
  { key: 'aspects', kind: 'process', name: 'Environmental aspects',
    clauses: ['6.1.2'], href: '/environmental/aspects', feeds: ['objectives', 'operational_control', 'emergency_preparedness'] },
  { key: 'obligations', kind: 'process', name: 'Compliance obligations',
    clauses: ['6.1.3'], href: '/environmental/obligations', feeds: ['operational_control', 'compliance_evaluation'] },
  { key: 'objectives', kind: 'process', name: 'Objectives, monitoring and measurement',
    clauses: ['6.2', '9.1.1'], href: '/environmental/objectives', feeds: ['management_review'] },

  { key: 'competence_awareness', kind: 'process', name: 'Competence and awareness',
    clauses: ['7.2', '7.3'], href: null, feeds: ['operational_control'] },
  { key: 'communication', kind: 'process', name: 'Communication',
    clauses: ['7.4'], href: null, feeds: ['management_review'] },
  { key: 'documented_information', kind: 'process', name: 'Documented information',
    clauses: ['7.5'], href: null, feeds: ['internal_audit'] },
  { key: 'operational_control', kind: 'process', name: 'Operational control',
    clauses: ['8.1'], href: null, feeds: ['nonconformity'] },
  { key: 'emergency_preparedness', kind: 'process', name: 'Emergency preparedness and response',
    clauses: ['8.2'], href: null, feeds: ['nonconformity'] },

  { key: 'compliance_evaluation', kind: 'process', name: 'Evaluation of compliance',
    clauses: ['9.1.2'], href: '/environmental/obligations', feeds: ['nonconformity', 'management_review'] },
  { key: 'internal_audit', kind: 'process', name: 'Internal audit',
    clauses: ['9.2'], href: null, feeds: ['nonconformity', 'management_review'] },
  { key: 'management_review', kind: 'process', name: 'Management review',
    clauses: ['9.3'], href: '/environmental/management-review', feeds: ['policy', 'objectives'] },
  { key: 'nonconformity', kind: 'process', name: 'Nonconformity and corrective action',
    clauses: ['10.2'], href: '/environmental/nonconformities', feeds: ['management_review'] },
]

export function isResponsibilityKey(value: string): value is ResponsibilityKey {
  return (RESPONSIBILITY_KEYS as readonly string[]).includes(value)
}

export interface ResponsibilityCoverage {
  /** Clause 5.3 roles with no owner. */
  rolesUnassigned:     number
  /** Processes on the map with no owner. */
  processesUnassigned: number
}

/** How much of the map has an owner, given the keys a tenant has assigned someone to. */
export function responsibilityCoverage(assigned: ReadonlySet<string>): ResponsibilityCoverage {
  const unassigned = EMS_RESPONSIBILITIES.filter(r => !assigned.has(r.key))
  return {
    rolesUnassigned:     unassigned.filter(r => r.kind === 'role').length,
    processesUnassigned: unassigned.filter(r => r.kind === 'process').length,
  }
}

/**
 * The hub light for the map: red while a clause 5.3 role has no one,
 * because then nobody answers for the system itself; amber while a process
 * has no owner; green when every responsibility is held.
 */
export function responsibilitiesHealth(coverage: ResponsibilityCoverage): RegisterHealth {
  if (coverage.rolesUnassigned > 0) return 'red'
  return coverage.processesUnassigned > 0 ? 'amber' : 'green'
}
