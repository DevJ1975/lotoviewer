// Compliance obligations (ISO 14001 clause 6.1.3) and their evaluation of
// compliance (clause 9.1.2). An obligation's deadline fields (cadence,
// next_due_at) say when something is due; its evaluation cadence says how
// often the organization checks that it complies. The two are kept apart
// on purpose. An evaluation is also the to-do: the nightly job schedules
// one, and recording a result closes it.

import type { FieldError } from './hazardousWaste'
import { addCalendarDays } from './managementSystem'

export const EVALUATION_RESULTS = ['compliant', 'noncompliant', 'not_applicable', 'undetermined'] as const
export type EvaluationResult = typeof EVALUATION_RESULTS[number]

/** Where an obligation comes from (the legal-register "source" column). */
export const OBLIGATION_SOURCE_KINDS = ['law', 'permit', 'contract', 'voluntary', 'internal'] as const
export type ObligationSourceKind = typeof OBLIGATION_SOURCE_KINDS[number]

/** Days before an evaluation falls due that the nightly job schedules it, so its owner has a month to gather evidence. */
export const EVALUATION_LEAD_DAYS = 30

// ── Jurisdiction ─────────────────────────────────────────────────────────

export type Jurisdiction =
  | { level: 'federal' }
  | { level: 'state'; state: string }
  | { level: 'local'; name: string }

/**
 * Parse the stored jurisdiction text: 'federal', 'state:XX' (two upper-case
 * letters) or 'local:<name>'. Null when malformed, so state rules stay data
 * (an obligation's jurisdiction), never code. The database check in
 * migration 298 accepts exactly the same strings.
 */
export function parseJurisdiction(raw: string): Jurisdiction | null {
  if (raw === 'federal') return { level: 'federal' }
  const state = /^state:([A-Z]{2})$/.exec(raw)
  if (state) return { level: 'state', state: state[1] }
  const local = /^local:(.+)$/.exec(raw)
  if (local && local[1].trim().length > 0) return { level: 'local', name: local[1] }
  return null
}

/** Human label for a jurisdiction, e.g. "State (TX)". */
export function formatJurisdiction(jurisdiction: Jurisdiction): string {
  switch (jurisdiction.level) {
    case 'federal': return 'Federal'
    case 'state':   return `State (${jurisdiction.state})`
    case 'local':   return `Local (${jurisdiction.name})`
  }
}

// ── Scheduling (the nightly job's pure core) ─────────────────────────────

export interface SchedulableObligation {
  id: string
  /** Days between evaluations; null means the obligation is never auto-scheduled. */
  evaluationCadenceDays: number | null
  /** False once the obligation is completed or dismissed. */
  active: boolean
}

export interface EvaluationRecord {
  obligationId: string
  /** ISO timestamp, or null while the evaluation is still open. */
  completedAt: string | null
}

export interface ScheduledEvaluation {
  obligationId: string
  /** ISO calendar date the evaluation is due. */
  scheduledFor: string
}

/**
 * The evaluations the nightly job must create today. An active obligation
 * with an evaluation cadence needs one when it has no open evaluation and
 * its next evaluation falls due within EVALUATION_LEAD_DAYS. Next due is
 * the last completed evaluation plus the cadence; an obligation never
 * evaluated is due today. At most one result per obligation.
 *
 * @param today ISO calendar date (YYYY-MM-DD).
 */
export function evaluationsToSchedule(
  obligations: readonly SchedulableObligation[],
  evaluations: readonly EvaluationRecord[],
  today: string,
): ScheduledEvaluation[] {
  const hasOpen = new Set<string>()
  const lastCompleted = new Map<string, string>()
  for (const e of evaluations) {
    if (e.completedAt === null) { hasOpen.add(e.obligationId); continue }
    const completedOn = e.completedAt.slice(0, 10)
    const previous = lastCompleted.get(e.obligationId)
    if (!previous || completedOn > previous) lastCompleted.set(e.obligationId, completedOn)
  }

  const horizon = addCalendarDays(today, EVALUATION_LEAD_DAYS)
  const scheduled: ScheduledEvaluation[] = []
  for (const obligation of obligations) {
    if (!obligation.active || obligation.evaluationCadenceDays === null) continue
    if (hasOpen.has(obligation.id)) continue
    const last = lastCompleted.get(obligation.id)
    const dueOn = last ? addCalendarDays(last, obligation.evaluationCadenceDays) : today
    if (dueOn <= horizon) scheduled.push({ obligationId: obligation.id, scheduledFor: dueOn })
  }
  return scheduled
}

// ── Completion ───────────────────────────────────────────────────────────

export type EvaluationGap = 'result_required' | 'evidence_required' | 'notes_required'

/**
 * What still blocks closing an evaluation. A compliant or noncompliant
 * result must point at evidence (the auditor samples it; migration 299
 * enforces the same rule); "not applicable" must say why in the notes.
 * Empty means the evaluation can close.
 */
export function evaluationCompletionGaps(input: {
  result:        EvaluationResult | null
  evidenceCount: number
  notes:         string | null
}): EvaluationGap[] {
  if (input.result === null) return ['result_required']
  const gaps: EvaluationGap[] = []
  if ((input.result === 'compliant' || input.result === 'noncompliant') && input.evidenceCount < 1) {
    gaps.push('evidence_required')
  }
  if (input.result === 'not_applicable' && (input.notes ?? '').trim().length === 0) {
    gaps.push('notes_required')
  }
  return gaps
}

// ── Obligation register fields ───────────────────────────────────────────

export interface ObligationRegisterInput {
  title:                  string
  sourceKind:             ObligationSourceKind
  citation:               string | null
  /** Null when no jurisdiction applies: a contract, a voluntary commitment, an internal requirement. */
  jurisdiction:           string | null
  applicabilityRationale: string | null
  evaluationCadenceDays:  number | null
}

const MAX_EVALUATION_CADENCE_DAYS = 3650

/** Validate an obligation's register fields. Empty means acceptable. */
export function validateObligationRegisterInput(input: ObligationRegisterInput): FieldError[] {
  const errors: FieldError[] = []
  if (input.title.trim().length === 0) errors.push({ field: 'title', message: 'is required' })
  else if (input.title.length > 300) errors.push({ field: 'title', message: 'must be at most 300 characters' })
  if (!OBLIGATION_SOURCE_KINDS.includes(input.sourceKind)) {
    errors.push({ field: 'sourceKind', message: 'must be law, permit, contract, voluntary, or internal' })
  }
  if (input.citation !== null && input.citation.length > 300) {
    errors.push({ field: 'citation', message: 'must be at most 300 characters' })
  }
  if (input.jurisdiction === null) {
    if (input.sourceKind === 'law' || input.sourceKind === 'permit') {
      errors.push({ field: 'jurisdiction', message: 'is required for a law or a permit' })
    }
  } else if (parseJurisdiction(input.jurisdiction) === null) {
    errors.push({ field: 'jurisdiction', message: "must be 'federal', 'state:XX', or 'local:<name>'" })
  }
  if (input.applicabilityRationale !== null && input.applicabilityRationale.length > 4000) {
    errors.push({ field: 'applicabilityRationale', message: 'must be at most 4000 characters' })
  }
  const cadence = input.evaluationCadenceDays
  if (cadence !== null && (!Number.isInteger(cadence) || cadence < 1 || cadence > MAX_EVALUATION_CADENCE_DAYS)) {
    errors.push({ field: 'evaluationCadenceDays', message: `must be a whole number from 1 to ${MAX_EVALUATION_CADENCE_DAYS}` })
  }
  return errors
}
