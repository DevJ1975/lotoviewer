import type { FieldError } from '@soteria/core/hazardousWaste'
import {
  holderOfRecordMismatch,
  permitEscalation,
  permitStanding,
  renewalDeadline,
  validatePermitInput,
  validateRenewalSubmission,
  validateRenewedTerm,
  type Escalation,
  type PermitInput,
  type PermitStanding,
  type PermitInstrument,
  type PermitProgram,
  type RenewedTermInput,
} from '@soteria/core/environmentalPermit'
import type { Parsed } from './contextRegisters'
import { UUID_RE, optionalText, text, type JsonObject } from './registerApi'

// The permit vault's request bodies (Phase 2 plan D1-D7). The rules live in
// packages/core/src/environmentalPermit.ts; this file only reads bodies into
// the shapes those rules take, with the column names the routes store.

/** Body columns a permit edit may change, and the input field each feeds. Renewal and retirement have their own routes. */
export const PERMIT_EDITABLE = {
  program:                    'program',
  instrument:                 'instrument',
  title:                      'title',
  agency:                     'agency',
  permit_number:              'permitNumber',
  jurisdiction:               'jurisdiction',
  holder_of_record:           'holderOfRecord',
  issued_on:                  'issuedOn',
  expires_on:                 'expiresOn',
  renewal_application_due_on: 'renewalApplicationDueOn',
  business_critical:          'businessCritical',
  notes:                      'notes',
} as const satisfies Record<string, keyof PermitInput>

/** Every permit column a client reads. */
export const PERMIT_COLUMNS =
  'id, tenant_id, facility_id, program, instrument, title, agency, permit_number, jurisdiction, holder_of_record, '
  + 'issued_on, expires_on, renewal_application_due_on, renewal_submitted_on, business_critical, owner_user_id, notes, '
  + 'retired_at, retired_reason, last_reviewed_at, reviewed_by, next_review_due, created_by, updated_by, created_at, updated_at'

export function permitInputFrom(raw: JsonObject): Parsed<PermitInput> {
  const input: PermitInput = {
    program:                 text(raw.program) as PermitProgram,
    instrument:              (optionalText(raw.instrument) ?? 'permit') as PermitInstrument,
    title:                   text(raw.title),
    agency:                  text(raw.agency),
    permitNumber:            optionalText(raw.permit_number),
    jurisdiction:            text(raw.jurisdiction),
    holderOfRecord:          text(raw.holder_of_record),
    issuedOn:                optionalText(raw.issued_on),
    expiresOn:               optionalText(raw.expires_on),
    renewalApplicationDueOn: optionalText(raw.renewal_application_due_on),
    businessCritical:        raw.business_critical === true,
    notes:                   optionalText(raw.notes),
  }
  const errors: FieldError[] = validatePermitInput(input)
  if (raw.business_critical !== undefined && typeof raw.business_critical !== 'boolean') {
    errors.push({ field: 'businessCritical', message: 'must be true or false' })
  }
  return errors.length === 0 ? { ok: true, input } : { ok: false, errors }
}

/** A body's owner_user_id: a user id, null to clear it, or undefined when absent. Membership is the database's to check. */
export function ownerFrom(raw: JsonObject): Parsed<string | null | undefined> {
  if (!('owner_user_id' in raw)) return { ok: true, input: undefined }
  const value = raw.owner_user_id
  if (value === null) return { ok: true, input: null }
  if (typeof value === 'string' && UUID_RE.test(value)) return { ok: true, input: value }
  return { ok: false, errors: [{ field: 'ownerUserId', message: 'must be a member\'s user id, or null' }] }
}

export type RenewalAction =
  | { action: 'submitted'; submittedOn: string }
  | { action: 'renewed'; term: RenewedTermInput }

/**
 * POST /permits/[id]/renewal: either "the renewal application went in on
 * this date", or "the agency renewed it: here is the new term".
 */
export function renewalActionFrom(
  raw: JsonObject,
  current: { issuedOn: string | null },
  latestDate: string,
): Parsed<RenewalAction> {
  switch (raw.action) {
    case 'submitted': {
      const submittedOn = text(raw.submitted_on)
      const errors = validateRenewalSubmission(submittedOn, current, latestDate)
      return errors.length === 0 ? { ok: true, input: { action: 'submitted', submittedOn } } : { ok: false, errors }
    }
    case 'renewed': {
      const term: RenewedTermInput = {
        issuedOn:                text(raw.issued_on),
        expiresOn:               optionalText(raw.expires_on),
        renewalApplicationDueOn: optionalText(raw.renewal_application_due_on),
        permitNumber:            optionalText(raw.permit_number),
      }
      const errors = validateRenewedTerm(term, current.issuedOn)
      return errors.length === 0 ? { ok: true, input: { action: 'renewed', term } } : { ok: false, errors }
    }
    default:
      return { ok: false, errors: [{ field: 'action', message: "must be 'submitted' or 'renewed'" }] }
  }
}

/**
 * The calendar category a permit's conditions are filed under, in the
 * vocabulary the obligations register already uses, so a chemical change
 * finds the air and waste conditions (managementOfChange.ts).
 */
export const CONDITION_CATEGORY: Readonly<Record<PermitProgram, string>> = {
  air:        'air',
  waste:      'waste',
  wastewater: 'wastewater',
  stormwater: 'stormwater',
  spcc:       'spill',
  epcra:      'chemicals',
  other:      'general',
}

/** A stored permit, as PERMIT_COLUMNS reads it. */
export interface PermitRow {
  id:                          string
  holder_of_record:            string
  expires_on:                  string | null
  renewal_application_due_on:  string | null
  renewal_submitted_on:        string | null
  retired_at:                  string | null
  [column: string]:            unknown
}

/** A permit's conditions, counted: open ones, and those past their due date. */
export interface ConditionCounts { open: number; overdue: number }

/** A permit row with what the vault screens show about it, worked out by the core rules. */
export type DescribedPermit = PermitRow & {
  standing:           PermitStanding
  renewal_deadline:   string | null
  /** Null for a retired permit or one with no fixed term. */
  escalation:         Escalation | null
  /** Null when no scope is recorded to compare against. */
  holder_mismatch:    boolean | null
  conditions_open:    number
  conditions_overdue: number
}

export function describePermit(
  row: PermitRow,
  legalEntityInForce: string | null,
  today: string,
  conditions: ConditionCounts = { open: 0, overdue: 0 },
): DescribedPermit {
  const dates = {
    retiredAt:               row.retired_at,
    expiresOn:               row.expires_on,
    renewalApplicationDueOn: row.renewal_application_due_on,
    renewalSubmittedOn:      row.renewal_submitted_on,
  }
  const deadline = renewalDeadline(dates)
  return {
    ...row,
    standing:           permitStanding(dates, today),
    renewal_deadline:   deadline,
    escalation:         deadline !== null && row.retired_at === null ? permitEscalation(deadline, today) : null,
    holder_mismatch:    row.retired_at === null ? holderOfRecordMismatch(row.holder_of_record, legalEntityInForce) : null,
    conditions_open:    conditions.open,
    conditions_overdue: conditions.overdue,
  }
}

/** Open and overdue conditions per permit, from obligation rows that carry a permit_id. */
export function conditionCountsByPermit(
  conditions: readonly { permit_id: string | null; status: string; next_due_at: string }[],
  today: string,
): Map<string, ConditionCounts> {
  const counts = new Map<string, ConditionCounts>()
  for (const condition of conditions) {
    if (condition.permit_id === null || condition.status !== 'open') continue
    const entry = counts.get(condition.permit_id) ?? { open: 0, overdue: 0 }
    entry.open += 1
    if (condition.next_due_at < today) entry.overdue += 1
    counts.set(condition.permit_id, entry)
  }
  return counts
}
