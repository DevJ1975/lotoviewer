import type { FieldError } from '@soteria/core/hazardousWaste'
import {
  validateContextIssueInput,
  validateInterestedPartyInput,
  validatePolicyCommunicationInput,
  validatePolicyInput,
  validateRetirementReason,
  validateScopeStatementInput,
  type ContextIssueEffect,
  type ContextIssueInput,
  type ContextIssueKind,
  type Discipline,
  type InterestedPartyInput,
  type PolicyAudience,
  type PolicyCommunicationInput,
  type PolicyInput,
  type ScopeStatementInput,
} from '@soteria/core/managementSystem'
import { emsDisciplineErrors, invalidInput, UUID_RE, optionalText, text, todayUtc, type JsonObject } from './registerApi'

// Request bodies for the context, interested-party, scope and policy
// registers (clauses 4.1, 4.2, 4.3, 5.2), turned into validated core inputs.
// Each parser takes the raw values a route collected, so POST passes the body
// and PATCH passes the stored row overlaid with the body: either way the
// whole record is validated, never just the changed fields.

export type Parsed<T> = { ok: true; input: T } | { ok: false; errors: FieldError[] }

function parsed<T>(input: T, errors: FieldError[]): Parsed<T> {
  return errors.length === 0 ? { ok: true, input } : { ok: false, errors }
}

export function contextIssueInputFrom(raw: JsonObject): Parsed<ContextIssueInput> {
  const input: ContextIssueInput = {
    discipline:  text(raw.discipline) as Discipline,
    kind:        text(raw.kind) as ContextIssueKind,
    description: text(raw.description),
    relevance:   optionalText(raw.relevance),
    effect:      optionalText(raw.effect) as ContextIssueEffect | null,
  }
  return parsed(input, [...validateContextIssueInput(input), ...emsDisciplineErrors(input.discipline)])
}

export function interestedPartyInputFrom(raw: JsonObject): Parsed<InterestedPartyInput> {
  const obligationId = optionalText(raw.obligation_id)
  const input: InterestedPartyInput = {
    discipline:        text(raw.discipline) as Discipline,
    name:              text(raw.name),
    needsExpectations: text(raw.needs_expectations),
    becomesObligation: raw.becomes_obligation === true,
    obligationId,
  }
  const errors = [...validateInterestedPartyInput(input), ...emsDisciplineErrors(input.discipline)]
  if (obligationId !== null && !UUID_RE.test(obligationId)) {
    errors.push({ field: 'obligationId', message: 'must be an obligation id' })
  }
  return parsed(input, errors)
}

export function scopeStatementInputFrom(raw: JsonObject, now: Date = new Date()): Parsed<ScopeStatementInput> {
  const input: ScopeStatementInput = {
    discipline:       text(raw.discipline) as Discipline,
    legalEntity:      text(raw.legal_entity),
    physicalBoundary: text(raw.physical_boundary),
    activities:       text(raw.activities),
    productsServices: text(raw.products_services),
    controlAndInfluence: text(raw.control_and_influence),
    exclusions:       optionalText(raw.exclusions),
    effectiveFrom:    optionalText(raw.effective_from) ?? todayUtc(now),
  }
  return parsed(input, [...validateScopeStatementInput(input), ...emsDisciplineErrors(input.discipline)])
}

export function policyInputFrom(raw: JsonObject): Parsed<PolicyInput> {
  const commitments = raw.commitments
  const isObject = commitments !== null && typeof commitments === 'object' && !Array.isArray(commitments)
  const input: PolicyInput = {
    discipline:     text(raw.discipline) as Discipline,
    body:           text(raw.body),
    commitments:    isObject ? commitments as Record<string, boolean> : {},
    signatoryName:  text(raw.signatory_name),
    signatoryTitle: optionalText(raw.signatory_title),
    signedAt:       text(raw.signed_at),
  }
  const errors = [...validatePolicyInput(input), ...emsDisciplineErrors(input.discipline)]
  if (!isObject) errors.push({ field: 'commitments', message: 'must be an object of commitment keys to true or false' })
  return parsed(input, errors)
}

export function policyCommunicationInputFrom(raw: JsonObject, now: Date = new Date()): Parsed<PolicyCommunicationInput> {
  const input: PolicyCommunicationInput = {
    audience:       text(raw.audience) as PolicyAudience,
    method:         text(raw.method),
    communicatedOn: optionalText(raw.communicated_on) ?? todayUtc(now),
  }
  return parsed(input, validatePolicyCommunicationInput(input, todayUtc(now)))
}

export interface RetirementColumns {
  retired_at:     string | null
  retired_reason: string | null
}

/**
 * The retired pair after a PATCH that names `retired_reason`: a reason
 * retires the row (keeping the original date if it was already retired);
 * an explicit null reinstates it. A blank reason is refused, because a
 * retired row must say why.
 */
export function retirementFrom(
  reason: unknown,
  current: RetirementColumns,
  now: Date = new Date(),
): Parsed<RetirementColumns> {
  if (reason === null) return { ok: true, input: { retired_at: null, retired_reason: null } }
  const trimmed = text(reason)
  const errors = validateRetirementReason(trimmed)
  return parsed({ retired_at: current.retired_at ?? now.toISOString(), retired_reason: trimmed }, errors)
}

/**
 * The same-tenant foreign key refused the obligation link: the id names no
 * obligation in this tenant. Said plainly instead of an opaque invalid_ref.
 */
export function unknownObligation() {
  return invalidInput([{ field: 'obligationId', message: 'is not an obligation in this organization' }])
}
