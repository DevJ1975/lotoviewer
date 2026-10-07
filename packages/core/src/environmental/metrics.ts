// The numbers a dashboard shows for the environmental suite. Pure counts over
// rows the caller already fetched, so the same figures feed the home panel, the
// assistant tool and the reminders digest.

import { checklistDueStatus } from './checklists'
import { daysUntilDue, type ObligationCadence } from '../complianceCalendar'
import { reviewState } from './legalRegister'
import { permitHealth, type PermitLike } from './permits'

export interface EnvKpiInput {
  obligations: ReadonlyArray<{ status: string; nextDueAt: string; leadDays: number }>
  checklistTemplates: ReadonlyArray<{ lastSubmittedOn: string | null; cadence: ObligationCadence; cadenceDays: number | null }>
  /** Environmental nonconformities (source_reference starting "env-"). */
  findings: ReadonlyArray<{ status: string }>
  permits: readonly PermitLike[]
  legal: ReadonlyArray<{ applicability: string; lastReviewedAt: string | null; nextReviewDue: string | null }>
}

export interface EnvKpis {
  obligationsOverdue:   number
  obligationsDueSoon:   number
  checklistsOverdue:    number
  checklistsNeverRun:   number
  openFindings:         number
  permitsExpiring:      number
  permitsExpired:       number
  legalReviewsOverdue:  number
  legalNeverReviewed:   number
}

export function summarizeEnvironmentalKpis(input: EnvKpiInput, now: Date = new Date()): EnvKpis {
  const open = input.obligations.filter(o => o.status === 'open')
  const days = (iso: string) => daysUntilDue(iso, now)

  const checklists = input.checklistTemplates.map(t => checklistDueStatus(t.lastSubmittedOn, t.cadence, t.cadenceDays, now).status)
  const permitStates = input.permits.map(p => permitHealth(p, now))
  const applicable = input.legal.filter(l => l.applicability === 'applicable')
  const reviews = applicable.map(l => reviewState(l, now))

  return {
    obligationsOverdue:  open.filter(o => days(o.nextDueAt) < 0).length,
    obligationsDueSoon:  open.filter(o => days(o.nextDueAt) >= 0 && days(o.nextDueAt) <= o.leadDays).length,
    checklistsOverdue:   checklists.filter(s => s === 'overdue').length,
    checklistsNeverRun:  checklists.filter(s => s === 'never').length,
    openFindings:        input.findings.filter(f => f.status === 'open' || f.status === 'in_progress').length,
    permitsExpiring:     permitStates.filter(s => s === 'expiring').length,
    permitsExpired:      permitStates.filter(s => s === 'expired').length,
    legalReviewsOverdue: reviews.filter(s => s === 'overdue').length,
    legalNeverReviewed:  reviews.filter(s => s === 'never_reviewed').length,
  }
}

/** Anything here wants a person's attention today. */
export function needsAttention(kpis: EnvKpis): boolean {
  return kpis.obligationsOverdue + kpis.checklistsOverdue + kpis.permitsExpired + kpis.legalReviewsOverdue > 0
}
