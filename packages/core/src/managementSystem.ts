// Shared management-system core: the rules ISO 14001 (environmental) and
// ISO 45001 (OH&S) have in common because both follow the Annex SL
// structure. Environmental-only rules live beside their records
// (environmentalAspect.ts and friends); this module holds what an OH&S
// register will reuse unchanged. See docs/ems/EMS_IMPLEMENTATION_PLAN.md,
// "ISO 45001 extension".

import type { FieldError } from './hazardousWaste'

/** Every standard a shared management-system record can belong to. */
export const DISCIPLINES = ['ems', 'ohs', 'integrated'] as const

/**
 * Which management system a shared record belongs to: `ems` (ISO 14001),
 * `ohs` (ISO 45001), or `integrated` for a tenant that runs one combined
 * system. Shared tables carry it as a `discipline` column so the same
 * register serves both standards.
 */
export type Discipline = typeof DISCIPLINES[number]

/**
 * The disciplines one standard's registers show: its own records plus the
 * integrated ones, which belong to both standards.
 */
export function registerDisciplines(standard: Exclude<Discipline, 'integrated'>): readonly Discipline[] {
  return [standard, 'integrated']
}

/** Traffic-light state of a register, as shown on the dashboard. */
export type RegisterHealth = 'green' | 'amber' | 'red'

/** The two facts register health needs from any register row. */
export interface RegisterRow {
  /** False once the row is retired (e.g. an obsolete aspect). Retired rows stay in history but never affect health. */
  active: boolean
  /** ISO calendar date (YYYY-MM-DD) by which the row must next be reviewed. */
  nextReviewDue: string
}

/**
 * Health of a register (aspects, obligations, context, …).
 *
 * An auditor's first request is a dated register, so absence and staleness
 * must show without anyone running a report:
 * - `red`: no active rows. The register effectively does not exist.
 * - `amber`: at least one active row is past its review date.
 * - `green`: every active row is within its review date.
 *
 * A row due today is not yet overdue.
 *
 * @param rows  The register's rows, active and retired.
 * @param today Today's ISO calendar date (YYYY-MM-DD) in the site's timezone.
 */
export function registerHealth(rows: readonly RegisterRow[], today: string): RegisterHealth {
  const active = rows.filter(row => row.active)
  if (active.length === 0) return 'red'
  return active.some(row => row.nextReviewDue < today) ? 'amber' : 'green'
}

// ── Review dates ──────────────────────────────────────────────────────────

/** How often a register row must be re-reviewed when nothing more specific applies. */
export const DEFAULT_REVIEW_CADENCE_DAYS = 365

/**
 * The ISO calendar date `days` after `date`, in UTC calendar days so the
 * answer never depends on the server's timezone.
 * @param date ISO calendar date (YYYY-MM-DD).
 */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/**
 * When a row reviewed on `reviewedOn` is next due for review.
 * @param reviewedOn ISO calendar date (YYYY-MM-DD) of the review.
 * @param cadenceDays Days between reviews; a whole number of at least 1.
 */
export function nextReviewDue(reviewedOn: string, cadenceDays: number): string {
  return addCalendarDays(reviewedOn, cadenceDays)
}

// ── Policy (clause 5.2) ──────────────────────────────────────────────────

export interface PolicyCommitment {
  /** Key in the policy's `commitments` map, prefixed by standard. */
  key: string
  label: string
}

/**
 * The commitments each standard requires its policy to state. Keys are
 * prefixed by standard so one `commitments` map can hold both; an
 * integrated policy must state both lists.
 */
export const REQUIRED_POLICY_COMMITMENTS: Readonly<Record<'ems' | 'ohs', readonly PolicyCommitment[]>> = {
  // ISO 14001:2015 clause 5.2 c), d), e)
  ems: [
    { key: 'ems.protect_environment',     label: 'Protect the environment, including preventing pollution' },
    { key: 'ems.fulfil_obligations',      label: 'Fulfil our compliance obligations' },
    { key: 'ems.continual_improvement',   label: 'Continually improve the environmental management system' },
  ],
  // ISO 45001:2018 clause 5.2 a), c), d), e), f)
  ohs: [
    { key: 'ohs.safe_healthy_conditions',          label: 'Provide safe and healthy working conditions' },
    { key: 'ohs.eliminate_hazards_reduce_risks',   label: 'Eliminate hazards and reduce OH&S risks' },
    { key: 'ohs.consultation_participation',       label: 'Consult workers and enable their participation' },
    { key: 'ohs.fulfil_obligations',               label: 'Fulfil our legal and other requirements' },
    { key: 'ohs.continual_improvement',            label: 'Continually improve the OH&S management system' },
  ],
}

/** The commitments a policy for `discipline` must state. */
export function requiredCommitments(discipline: Discipline): readonly PolicyCommitment[] {
  if (discipline === 'integrated') return [...REQUIRED_POLICY_COMMITMENTS.ems, ...REQUIRED_POLICY_COMMITMENTS.ohs]
  return REQUIRED_POLICY_COMMITMENTS[discipline]
}

export interface PolicyCompletenessInput {
  commitments:   Readonly<Record<string, boolean>>
  signatoryName: string | null
  signedAt:      string | null
}

/**
 * A policy is complete when it states every commitment its standard
 * requires and someone has signed and dated it. An auditor treats a missing
 * commitment or an unsigned policy as a nonconformity, so the policy form
 * refuses to save an incomplete one.
 */
export function policyIsComplete(policy: PolicyCompletenessInput, discipline: Discipline): boolean {
  const statesEveryCommitment = requiredCommitments(discipline).every(c => policy.commitments[c.key] === true)
  const signed = (policy.signatoryName ?? '').trim().length > 0 && (policy.signedAt ?? '').length > 0
  return statesEveryCommitment && signed
}

export interface ScopeVersion {
  version:       number
  legalEntity:   string
  effectiveFrom: string
}

/**
 * True when the legal entity in the scope changed after the policy was
 * signed: the policy still carries a previous owner's signature (Lesson L3).
 * A first scope version is not a change.
 * @param policy The policy in force; signedAt is an ISO calendar date.
 * @param scopes Every scope version for the same discipline, in any order.
 */
export function policySignatoryStale(policy: { signedAt: string }, scopes: readonly ScopeVersion[]): boolean {
  const ordered = [...scopes].sort((a, b) => a.version - b.version)
  let lastEntityChange: string | null = null
  for (let i = 1; i < ordered.length; i++) {
    const entityChanged = ordered[i].legalEntity.trim().toLowerCase() !== ordered[i - 1].legalEntity.trim().toLowerCase()
    if (entityChanged) lastEntityChange = ordered[i].effectiveFrom
  }
  return lastEntityChange !== null && lastEntityChange > policy.signedAt
}

// ── Context (clauses 4.1, 4.2) ───────────────────────────────────────────

export const CONTEXT_ISSUE_KINDS = ['internal', 'external', 'climate'] as const
export type ContextIssueKind = typeof CONTEXT_ISSUE_KINDS[number]

/** Clause 6.1.1: whether an issue is a risk, an opportunity, or both. */
export const CONTEXT_ISSUE_EFFECTS = ['risk', 'opportunity', 'both'] as const
export type ContextIssueEffect = typeof CONTEXT_ISSUE_EFFECTS[number]

/**
 * Health of the context-issues register. Like registerHealth, then amber
 * when no active issue records the organization's climate-change
 * determination: ISO 14001 Amd 1:2024 requires the organization to decide
 * whether climate change is a relevant issue, so its absence is a gap.
 */
export function contextRegisterHealth(
  rows: readonly (RegisterRow & { kind: ContextIssueKind })[],
  today: string,
): RegisterHealth {
  const health = registerHealth(rows, today)
  if (health !== 'green') return health
  return rows.some(row => row.active && row.kind === 'climate') ? 'green' : 'amber'
}

// ── Register inputs ──────────────────────────────────────────────────────
// What a person may type into the context, interested-party, scope and
// policy registers. Each validator returns every problem at once, keyed by
// input field; an empty list means the input is acceptable.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real calendar date written YYYY-MM-DD: '2026-02-30' is not one. */
export function isCalendarDate(value: string): boolean {
  return ISO_DATE_RE.test(value) && addCalendarDays(value, 0) === value
}

function requireText(errors: FieldError[], field: string, value: string, max: number): void {
  if (value.trim().length === 0) errors.push({ field, message: 'is required' })
  else if (value.length > max) errors.push({ field, message: `must be at most ${max} characters` })
}

function limitText(errors: FieldError[], field: string, value: string | null, max: number): void {
  if (value !== null && value.length > max) errors.push({ field, message: `must be at most ${max} characters` })
}

function requireDiscipline(errors: FieldError[], discipline: Discipline): void {
  if (!DISCIPLINES.includes(discipline)) errors.push({ field: 'discipline', message: 'must be ems, ohs, or integrated' })
}

/** Why a register row is being retired. Retired rows keep their history, so the reason is required. */
export function validateRetirementReason(reason: string, field = 'retiredReason'): FieldError[] {
  const errors: FieldError[] = []
  requireText(errors, field, reason, 2000)
  return errors
}

export interface ContextIssueInput {
  discipline:  Discipline
  kind:        ContextIssueKind
  description: string
  relevance:   string | null
  effect:      ContextIssueEffect | null
}

export function validateContextIssueInput(input: ContextIssueInput): FieldError[] {
  const errors: FieldError[] = []
  requireDiscipline(errors, input.discipline)
  if (!CONTEXT_ISSUE_KINDS.includes(input.kind)) {
    errors.push({ field: 'kind', message: 'must be internal, external, or climate' })
  }
  requireText(errors, 'description', input.description, 2000)
  limitText(errors, 'relevance', input.relevance, 2000)
  if (input.effect !== null && !CONTEXT_ISSUE_EFFECTS.includes(input.effect)) {
    errors.push({ field: 'effect', message: 'must be risk, opportunity, or both' })
  }
  return errors
}

export interface InterestedPartyInput {
  discipline:        Discipline
  name:              string
  needsExpectations: string
  /** Clause 4.2 c): the organization adopts this party's need as a compliance obligation. */
  becomesObligation: boolean
  obligationId:      string | null
}

export function validateInterestedPartyInput(input: InterestedPartyInput): FieldError[] {
  const errors: FieldError[] = []
  requireDiscipline(errors, input.discipline)
  requireText(errors, 'name', input.name, 200)
  requireText(errors, 'needsExpectations', input.needsExpectations, 4000)
  if (input.obligationId !== null && !input.becomesObligation) {
    errors.push({ field: 'obligationId', message: 'can only be set when the need becomes a compliance obligation' })
  }
  return errors
}

export interface ScopeStatementInput {
  discipline:       Discipline
  legalEntity:      string
  physicalBoundary: string
  activities:       string
  productsServices: string
  /** ISO calendar date from which this version is the scope. */
  effectiveFrom:    string
}

export function validateScopeStatementInput(input: ScopeStatementInput): FieldError[] {
  const errors: FieldError[] = []
  requireDiscipline(errors, input.discipline)
  requireText(errors, 'legalEntity', input.legalEntity, 300)
  requireText(errors, 'physicalBoundary', input.physicalBoundary, 4000)
  requireText(errors, 'activities', input.activities, 4000)
  requireText(errors, 'productsServices', input.productsServices, 4000)
  if (!isCalendarDate(input.effectiveFrom)) errors.push({ field: 'effectiveFrom', message: 'must be a date (YYYY-MM-DD)' })
  return errors
}

export interface PolicyInput {
  discipline:     Discipline
  body:           string
  commitments:    Readonly<Record<string, boolean>>
  signatoryName:  string
  signatoryTitle: string | null
  /** ISO calendar date the policy was signed. */
  signedAt:       string
}

const KNOWN_COMMITMENT_KEYS = new Set(requiredCommitments('integrated').map(c => c.key))

/**
 * Shape problems only. Whether the policy states every commitment its
 * standard requires is policyIsComplete(), a separate question with its own answer.
 */
export function validatePolicyInput(input: PolicyInput): FieldError[] {
  const errors: FieldError[] = []
  requireDiscipline(errors, input.discipline)
  requireText(errors, 'body', input.body, 20000)
  for (const [key, stated] of Object.entries(input.commitments)) {
    if (!KNOWN_COMMITMENT_KEYS.has(key)) errors.push({ field: 'commitments', message: `has an unknown commitment '${key}'` })
    else if (typeof stated !== 'boolean') errors.push({ field: 'commitments', message: `'${key}' must be true or false` })
  }
  requireText(errors, 'signatoryName', input.signatoryName, 200)
  limitText(errors, 'signatoryTitle', input.signatoryTitle, 200)
  if (!isCalendarDate(input.signedAt)) errors.push({ field: 'signedAt', message: 'must be a date (YYYY-MM-DD)' })
  return errors
}
