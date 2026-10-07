// The legal register: which requirements apply to a site, whether anyone has
// looked at them lately, and what the library suggests adding.

import { classifyUrgency } from '../complianceCalendar'
import { applies, type ApplicabilityContext } from './applicability'
import type { ResolvedLibrary } from './content'
import type { EnvProgram } from './siteProfile'

export const LEGAL_APPLICABILITY = ['applicable', 'not_applicable', 'under_review'] as const
export type LegalApplicability = typeof LEGAL_APPLICABILITY[number]

export const LEGAL_COMPLIANCE = ['not_evaluated', 'compliant', 'attention', 'non_compliant'] as const
export type LegalCompliance = typeof LEGAL_COMPLIANCE[number]

export type ReviewFrequency = 'annual' | 'biennial'

export type ReviewState = 'never_reviewed' | 'ok' | 'due_soon' | 'overdue'

const REVIEW_DUE_SOON_DAYS = 30

/**
 * Whether an entry needs a person's attention. Never looked at is its own state
 * (it is not "fine"), and a review date, once set, is judged against today.
 */
export function reviewState(
  entry: { lastReviewedAt: string | null; nextReviewDue: string | null }, now: Date = new Date(),
): ReviewState {
  if (entry.lastReviewedAt === null) return 'never_reviewed'
  if (entry.nextReviewDue === null) return 'ok'
  const urgency = classifyUrgency(entry.nextReviewDue, now, REVIEW_DUE_SOON_DAYS)
  return urgency === 'overdue' ? 'overdue' : urgency === 'due_soon' ? 'due_soon' : 'ok'
}

/** The date the next review falls due, a year or two after this one. */
export function nextReviewDate(reviewedOn: string, frequency: ReviewFrequency | null): string | null {
  if (frequency === null) return null
  const [y, m, d] = reviewedOn.slice(0, 10).split('-').map(Number)
  const years = frequency === 'biennial' ? 2 : 1
  const lastDay = new Date(Date.UTC(y! + years, m!, 0)).getUTCDate()
  return new Date(Date.UTC(y! + years, m! - 1, Math.min(d!, lastDay))).toISOString().slice(0, 10)
}

export interface LegalEntryPlan {
  library_key:        string
  program:            EnvProgram
  title:              string
  citation:           string
  jurisdiction:       string
  authority:          string
  summary:            string
  applicability_note: string
  source_url:         string | null
  review_frequency:   ReviewFrequency
  /** A verify note, if the library has not confirmed this entry. */
  verify:             string | null
  facility_id:        string | null
}

export interface LegalPlan {
  toCreate:       LegalEntryPlan[]
  existing:       string[]
  notApplicable:  string[]
}

/**
 * The register entries the library suggests for a site: those that apply and are
 * not already in the register (by library key). Never overwrites an entry a
 * person has edited or evaluated.
 */
export function planLegalEntries(
  library: ResolvedLibrary,
  context: ApplicabilityContext,
  facilityId: string | null,
  existingKeys: ReadonlySet<string>,
): LegalPlan {
  const plan: LegalPlan = { toCreate: [], existing: [], notApplicable: [] }
  for (const entry of library.legal) {
    if (!applies(entry.appliesWhen, context)) { plan.notApplicable.push(entry.id); continue }
    if (existingKeys.has(entry.id)) { plan.existing.push(entry.id); continue }
    plan.toCreate.push({
      library_key:        entry.id,
      program:            entry.program,
      title:              entry.title,
      citation:           entry.citation,
      jurisdiction:       entry.source,
      authority:          entry.authority,
      summary:            entry.summary,
      applicability_note: entry.applicabilityNote,
      source_url:         entry.sourceUrl ?? null,
      review_frequency:   entry.reviewFrequency,
      verify:             entry.verify ?? null,
      facility_id:        facilityId,
    })
  }
  return plan
}

export interface EvaluationInput {
  applicability:     LegalApplicability
  complianceStatus:  LegalCompliance
  note:              string | null
}

export type EvaluationValidation =
  | { ok: true; evaluation: EvaluationInput }
  | { ok: false; errors: string[] }

const MAX_NOTE = 2000

/**
 * Validate an evaluation: "does this apply to us, and are we meeting it". A
 * requirement that does not apply cannot also be rated; and a finding of
 * "attention" or "non_compliant" needs a note saying what is wrong, because a
 * red rating nobody can explain is worse than none.
 */
export function validateEvaluation(input: unknown): EvaluationValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['Expected an object.'] }
  const body = input as Record<string, unknown>
  const errors: string[] = []

  const applicability = body.applicability
  if (typeof applicability !== 'string' || !(LEGAL_APPLICABILITY as readonly string[]).includes(applicability)) {
    errors.push(`applicability must be one of: ${LEGAL_APPLICABILITY.join(', ')}.`)
  }
  const status = body.compliance_status === undefined ? 'not_evaluated' : body.compliance_status
  if (typeof status !== 'string' || !(LEGAL_COMPLIANCE as readonly string[]).includes(status)) {
    errors.push(`compliance_status must be one of: ${LEGAL_COMPLIANCE.join(', ')}.`)
  }
  let note: string | null = null
  if (body.note !== undefined && body.note !== null && body.note !== '') {
    if (typeof body.note !== 'string') errors.push('note must be text.')
    else if (body.note.length > MAX_NOTE) errors.push(`note is too long (the limit is ${MAX_NOTE} characters).`)
    else note = body.note.trim() || null
  }
  if (errors.length > 0) return { ok: false, errors }

  const a = applicability as LegalApplicability
  const s = status as LegalCompliance
  if (a === 'not_applicable' && s !== 'not_evaluated') {
    return { ok: false, errors: ['A requirement marked not applicable cannot also be rated; leave compliance_status as not_evaluated.'] }
  }
  if ((s === 'attention' || s === 'non_compliant') && note === null) {
    return { ok: false, errors: ['Say what is wrong: a rating of attention or non_compliant needs a note.'] }
  }
  return { ok: true, evaluation: { applicability: a, complianceStatus: s, note } }
}
