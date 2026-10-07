// The legal register: which requirements apply to a site, whether anyone has
// looked at them lately, and what the library suggests adding.

import { classifyUrgency } from '../complianceCalendar'
import { applies, type ApplicabilityContext } from './applicability'
import type { ResolvedLibrary } from './content'
import { ENV_PROGRAMS, type EnvProgram } from './siteProfile'
import { UUID_PATTERN, isRealDate } from './validation'

export const LEGAL_APPLICABILITY = ['applicable', 'not_applicable', 'under_review'] as const
export type LegalApplicability = typeof LEGAL_APPLICABILITY[number]

export const LEGAL_COMPLIANCE = ['not_evaluated', 'compliant', 'attention', 'non_compliant'] as const
export type LegalCompliance = typeof LEGAL_COMPLIANCE[number]

export const REVIEW_FREQUENCIES = ['annual', 'biennial'] as const
export type ReviewFrequency = typeof REVIEW_FREQUENCIES[number]

/** The stored column is free text, so anything that is not a known frequency reads as "none". */
export function parseReviewFrequency(value: unknown): ReviewFrequency | null {
  return (REVIEW_FREQUENCIES as readonly unknown[]).includes(value) ? value as ReviewFrequency : null
}

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
export function nextReviewDate(reviewedOn: string, frequency: ReviewFrequency): string
export function nextReviewDate(reviewedOn: string, frequency: ReviewFrequency | null): string | null
export function nextReviewDate(reviewedOn: string, frequency: ReviewFrequency | null): string | null {
  if (frequency === null) return null
  const [y, m, d] = reviewedOn.slice(0, 10).split('-').map(Number)
  const years = frequency === 'biennial' ? 2 : 1
  const lastDay = new Date(Date.UTC(y! + years, m!, 0)).getUTCDate()
  return new Date(Date.UTC(y! + years, m! - 1, Math.min(d!, lastDay))).toISOString().slice(0, 10)
}

export interface ReviewPlan {
  last_reviewed_at: string
  next_review_due:  string
}

/**
 * What recording a review writes. An entry with no review frequency is reviewed
 * yearly: a review that left no next date would let the entry drop out of the
 * review cycle for good.
 */
export function planReview(reviewedOn: string, frequency: ReviewFrequency | null): ReviewPlan {
  return { last_reviewed_at: reviewedOn, next_review_due: nextReviewDate(reviewedOn, frequency ?? 'annual') }
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

// ── a custom entry, or the descriptive fields of any entry ──────────────────

export interface LegalEntryInput {
  /** Null: a requirement for the whole company rather than one site. */
  facilityId:        string | null
  title:             string
  citation:          string
  jurisdiction:      string
  authority:         string | null
  summary:           string | null
  applicabilityNote: string | null
  sourceUrl:         string | null
  effectiveDate:     string | null
  reviewFrequency:   ReviewFrequency | null
  program:           EnvProgram | null
  ownerUserId:       string | null
  tags:              string[]
  evidencePath:      string | null
}

export type LegalEntryValidation =
  | { ok: true; entry: LegalEntryInput }
  | { ok: false; errors: string[] }

const JURISDICTION = /^(federal|[A-Z]{2})$/
// A scheme allow-list: the address becomes a link, and "javascript:" must not.
const HTTP_URL = /^https?:\/\/[^\s/?#]\S*$/i
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 50
const MAX_EVIDENCE_PATH = 300

/**
 * Evidence is a stored file that later becomes a signed URL, so a path outside
 * the caller's own folder (`prefix`) is refused. Empty clears the evidence.
 */
export function validateEvidencePath(
  value: unknown, prefix: string,
): { ok: true; path: string | null } | { ok: false; error: string } {
  if (value === null || value === '') return { ok: true, path: null }
  if (typeof value === 'string' && value.length <= MAX_EVIDENCE_PATH && value.startsWith(prefix) && !value.includes('..')) {
    return { ok: true, path: value }
  }
  return { ok: false, error: 'evidence_path must be a file you uploaded to this account.' }
}

/**
 * Validate the descriptive fields of a register entry (snake_case, like the
 * table): everything needed to add a custom entry, and everything a person may
 * edit on any entry. Left out of a partial update, a field keeps the value in
 * `current`.
 *
 * The evaluation (applicability, compliance_status, evaluation_note) and the
 * server-owned columns (source, library_key, the last_* stamps) are not read at
 * all: a body that carries them cannot change them here. The evaluation has its
 * own rules in validateEvaluation.
 */
export function validateLegalEntry(
  input: unknown,
  options: { evidencePathPrefix: string; current?: LegalEntryInput },
): LegalEntryValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['Expected an object.'] }
  const body = input as Record<string, unknown>
  const current = options.current
  const errors: string[] = []
  const has = (key: string) => key in body

  const text = (
    key: string, max: number, keep: string | null,
    rules: { required?: boolean; shape?: { pattern: RegExp; message: string } } = {},
  ): string | null => {
    if (!has(key)) {
      if (rules.required && keep === null) errors.push(`${key} is required.`)
      return keep
    }
    const v = body[key]
    if (v !== null && typeof v !== 'string') { errors.push(`${key} must be text.`); return keep }
    const t = (v ?? '').trim()
    if (t.length > max) { errors.push(`${key} is too long (the limit is ${max} characters).`); return keep }
    if (t === '') {
      if (rules.required) errors.push(`${key} is required.`)
      return null
    }
    if (rules.shape && !rules.shape.pattern.test(t)) { errors.push(rules.shape.message); return keep }
    return t
  }
  const id = (key: string, keep: string | null): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null) return null
    if (typeof v === 'string' && UUID_PATTERN.test(v)) return v.toLowerCase()
    errors.push(`${key} must be an id, or null.`)
    return keep
  }
  const enumOrNull = <T extends string>(key: string, allowed: readonly T[], keep: T | null): T | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
    errors.push(`${key} must be one of: ${allowed.join(', ')}, or empty.`)
    return keep
  }

  let effectiveDate = current?.effectiveDate ?? null
  if (has('effective_date')) {
    const v = body.effective_date
    if (v === null || v === '') effectiveDate = null
    else if (typeof v === 'string' && isRealDate(v)) effectiveDate = v
    else errors.push('effective_date must be a date like 2027-04-30.')
  }

  let tags = current?.tags ?? []
  if (has('tags')) {
    const v = body.tags
    if (!Array.isArray(v) || v.length > MAX_TAGS) errors.push(`tags must be a list of at most ${MAX_TAGS}.`)
    else if (v.some(tag => typeof tag !== 'string' || tag.trim() === '' || tag.trim().length > MAX_TAG_LENGTH)) {
      errors.push(`Each tag must be text of 1 to ${MAX_TAG_LENGTH} characters.`)
    } else tags = (v as string[]).map(tag => tag.trim())
  }

  let evidencePath = current?.evidencePath ?? null
  if (has('evidence_path')) {
    const checked = validateEvidencePath(body.evidence_path, options.evidencePathPrefix)
    if (checked.ok) evidencePath = checked.path
    else errors.push(checked.error)
  }

  const entry: LegalEntryInput = {
    facilityId:        id('facility_id', current?.facilityId ?? null),
    title:             text('title', 300, current?.title ?? null, { required: true }) ?? '',
    citation:          text('citation', 300, current?.citation ?? null, { required: true }) ?? '',
    jurisdiction:      text('jurisdiction', 20, current?.jurisdiction ?? null, {
      required: true, shape: { pattern: JURISDICTION, message: 'jurisdiction must be "federal" or a two-letter state code like CA.' },
    }) ?? '',
    authority:         text('authority', 300, current?.authority ?? null),
    summary:           text('summary', 4000, current?.summary ?? null),
    applicabilityNote: text('applicability_note', 2000, current?.applicabilityNote ?? null),
    sourceUrl:         text('source_url', 500, current?.sourceUrl ?? null, {
      shape: { pattern: HTTP_URL, message: 'source_url must be a web address starting with http:// or https://.' },
    }),
    effectiveDate,
    reviewFrequency:   enumOrNull('review_frequency', REVIEW_FREQUENCIES, current?.reviewFrequency ?? null),
    program:           enumOrNull('program', ENV_PROGRAMS, current?.program ?? null),
    ownerUserId:       id('owner_user_id', current?.ownerUserId ?? null),
    tags,
    evidencePath,
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entry }
}

// ── table <-> domain ────────────────────────────────────────────────────────

/** The descriptive fields as table columns. The inverse of parseLegalRow; it never carries the evaluation or the server-owned columns. */
export function toLegalRow(entry: LegalEntryInput): Record<string, unknown> {
  return {
    facility_id:        entry.facilityId,
    title:              entry.title,
    citation:           entry.citation,
    jurisdiction:       entry.jurisdiction,
    authority:          entry.authority,
    summary:            entry.summary,
    applicability_note: entry.applicabilityNote,
    source_url:         entry.sourceUrl,
    effective_date:     entry.effectiveDate,
    review_frequency:   entry.reviewFrequency,
    program:            entry.program,
    owner_user_id:      entry.ownerUserId,
    tags:               entry.tags,
    evidence_path:      entry.evidencePath,
  }
}

/** A stored register row as the domain object, used as `current` for a partial update. */
export function parseLegalRow(row: Record<string, unknown>): LegalEntryInput {
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    facilityId:        str(row.facility_id),
    title:             str(row.title) ?? '',
    citation:          str(row.citation) ?? '',
    jurisdiction:      str(row.jurisdiction) ?? '',
    authority:         str(row.authority),
    summary:           str(row.summary),
    applicabilityNote: str(row.applicability_note),
    sourceUrl:         str(row.source_url),
    effectiveDate:     str(row.effective_date),
    reviewFrequency:   parseReviewFrequency(row.review_frequency),
    program:           (ENV_PROGRAMS as readonly unknown[]).includes(row.program) ? row.program as EnvProgram : null,
    ownerUserId:       str(row.owner_user_id),
    tags:              Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    evidencePath:      str(row.evidence_path),
  }
}
