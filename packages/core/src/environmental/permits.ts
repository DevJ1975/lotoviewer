// Environmental permits: where each stands, and the renewal deadline it implies.

import { daysUntilDue } from '../complianceCalendar'
import type { PlannedObligation } from './calendarPlan'
import { LIBRARY_CATEGORY, librarySystemKey } from './calendarPlan'
import type { EnvProgram } from './siteProfile'

export const PERMIT_PROGRAMS = ['stormwater', 'air', 'wastewater', 'hazardous_waste', 'spcc', 'other'] as const
export type PermitProgram = typeof PERMIT_PROGRAMS[number]

export const PERMIT_STATUSES = ['draft', 'application_pending', 'active', 'expired', 'terminated', 'not_required'] as const
export type PermitStatus = typeof PERMIT_STATUSES[number]

export const DEFAULT_RENEWAL_LEAD_DAYS = 180

export type PermitHealth = 'active' | 'expiring' | 'expired' | 'not_tracked'

export interface PermitLike {
  status:          string
  expirationDate:  string | null
  renewalLeadDays: number
}

/**
 * Where a permit stands today. Only a permit that is in force is tracked: a draft,
 * a pending application or a terminated permit is "not_tracked", not "fine".
 * A permit past its expiration date is expired whatever its status field says
 * (a person forgot to update it), because the date is the fact that matters.
 * An active permit with no expiration date stays "active": some do not expire,
 * and an unknown date is not a reason to raise an alarm.
 */
export function permitHealth(permit: PermitLike, now: Date = new Date()): PermitHealth {
  if (permit.status === 'expired') return 'expired'
  if (permit.status !== 'active') return 'not_tracked'
  if (permit.expirationDate === null) return 'active'
  const days = daysUntilDue(permit.expirationDate, now)
  if (days < 0) return 'expired'
  if (days <= permit.renewalLeadDays) return 'expiring'
  return 'active'
}

export interface PermitForPlanning {
  id:              string
  facilityId:      string
  program:         PermitProgram
  permitType:      string
  permitNumber:    string | null
  status:          string
  expirationDate:  string | null
  renewalLeadDays: number
}

const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

/**
 * The renewal deadline for a permit in force: its expiration date less the
 * renewal lead time. Null when there is nothing to plan (not in force, or no
 * expiration date). A deadline already past is returned as is: a renewal window
 * that opened and was missed is exactly what the calendar should show as overdue.
 */
export function planPermitRenewal(permit: PermitForPlanning): PlannedObligation | null {
  if (permit.status !== 'active' || permit.expirationDate === null) return null
  const label = permit.permitNumber ? `${permit.permitType} ${permit.permitNumber}` : permit.permitType
  const program: EnvProgram = permit.program === 'other' ? 'stormwater' : permit.program
  return {
    system_key:     librarySystemKey(`permit-renewal:${permit.id}`, permit.facilityId),
    library_key:    `permit-renewal:${permit.id}`,
    facility_id:    permit.facilityId,
    program,
    title:          `Renew ${label}`,
    description:    `Permit expires ${permit.expirationDate}. Renewal is due ${permit.renewalLeadDays} days before expiration; check the permit itself for the exact lead time its agency requires.`,
    regulatory_ref: label,
    category:       LIBRARY_CATEGORY,
    cadence:        'once',
    cadence_days:   null,
    next_due_at:    addDays(permit.expirationDate, -permit.renewalLeadDays),
    lead_days:      30,
    due_anchor:     'fixed',
    jurisdiction:   'federal',
    legal_library_key:     null,
    checklist_library_key: null,
  }
}
