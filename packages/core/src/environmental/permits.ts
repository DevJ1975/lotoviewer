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

// ── what a person enters ────────────────────────────────────────────────────

export interface PermitCondition {
  id:         string
  text:       string
  frequency?: string
  ref?:       string
}

export interface PermitInput {
  facilityId:      string
  program:         PermitProgram
  permitType:      string
  permitNumber:    string | null
  issuingAgency:   string | null
  jurisdiction:    string | null
  status:          PermitStatus
  effectiveDate:   string | null
  expirationDate:  string | null
  renewalLeadDays: number
  identifiers:     Record<string, string>
  conditions:      PermitCondition[]
  documentPath:    string | null
  notes:           string | null
}

export type PermitValidation =
  | { ok: true; permit: PermitInput }
  | { ok: false; errors: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_CONDITIONS = 100
const MAX_IDENTIFIERS = 20

function isRealDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

/**
 * Validate a permit request body (snake_case, like the table). `documentPathPrefix`
 * is the folder the caller may reference: a document path later becomes a signed
 * URL, so a path into someone else's folder is refused here. Left out of a partial
 * update, a field keeps the value in `current`.
 */
export function validatePermit(
  input: unknown,
  options: { documentPathPrefix: string; current?: PermitInput },
): PermitValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['Expected an object.'] }
  const body = input as Record<string, unknown>
  const current = options.current
  const errors: string[] = []
  const has = (key: string) => key in body

  const text = (key: string, max: number, keep: string | null, required = false): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') { if (required) errors.push(`${key} is required.`); return null }
    if (typeof v !== 'string') { errors.push(`${key} must be text.`); return keep }
    const t = v.trim()
    if (t.length > max) { errors.push(`${key} is too long (the limit is ${max} characters).`); return keep }
    if (t === '' && required) errors.push(`${key} is required.`)
    return t || null
  }
  const enumOf = <T extends string>(key: string, allowed: readonly T[], keep: T): T => {
    if (!has(key)) return keep
    if (typeof body[key] === 'string' && (allowed as readonly string[]).includes(body[key] as string)) return body[key] as T
    errors.push(`${key} must be one of: ${allowed.join(', ')}.`)
    return keep
  }
  const date = (key: string, keep: string | null): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v === 'string' && isRealDate(v)) return v
    errors.push(`${key} must be a date like 2027-04-30.`)
    return keep
  }

  let facilityId = current?.facilityId ?? ''
  if (has('facility_id')) {
    if (typeof body.facility_id === 'string' && UUID.test(body.facility_id)) facilityId = body.facility_id.toLowerCase()
    else errors.push('facility_id must be an id.')
  }
  if (!facilityId && !errors.some(e => e.startsWith('facility_id'))) errors.push('facility_id is required: a permit belongs to one site.')

  const permitType = text('permit_type', 200, current?.permitType ?? null, true)
  if (permitType === null && !errors.some(e => e.startsWith('permit_type'))) errors.push('permit_type is required.')
  const jurisdiction = text('jurisdiction', 20, current?.jurisdiction ?? null)
  if (jurisdiction !== null && !/^(federal|[A-Z]{2})$/.test(jurisdiction)) errors.push('jurisdiction must be "federal" or a two-letter state code.')

  const effectiveDate = date('effective_date', current?.effectiveDate ?? null)
  const expirationDate = date('expiration_date', current?.expirationDate ?? null)
  if (effectiveDate && expirationDate && expirationDate < effectiveDate) errors.push('expiration_date cannot be before effective_date.')

  let renewalLeadDays = current?.renewalLeadDays ?? DEFAULT_RENEWAL_LEAD_DAYS
  if (has('renewal_lead_days')) {
    const v = body.renewal_lead_days
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1095) renewalLeadDays = v
    else errors.push('renewal_lead_days must be a whole number of days from 0 to 1095.')
  }

  let identifiers = current?.identifiers ?? {}
  if (has('identifiers')) {
    const v = body.identifiers
    if (typeof v !== 'object' || v === null || Array.isArray(v)) errors.push('identifiers must be an object of text values.')
    else {
      const entries = Object.entries(v as Record<string, unknown>)
      if (entries.length > MAX_IDENTIFIERS || entries.some(([k, val]) => k.length > 60 || typeof val !== 'string' || val.length > 200)) {
        errors.push(`identifiers must have at most ${MAX_IDENTIFIERS} entries, each a short text value.`)
      } else identifiers = Object.fromEntries(entries.map(([k, val]) => [k, (val as string).trim()]))
    }
  }

  let conditions = current?.conditions ?? []
  if (has('conditions')) {
    const v = body.conditions
    if (!Array.isArray(v) || v.length > MAX_CONDITIONS) errors.push(`conditions must be a list of at most ${MAX_CONDITIONS}.`)
    else {
      const parsed: PermitCondition[] = []
      v.forEach((raw, index) => {
        const c = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
        const textValue = typeof c.text === 'string' ? c.text.trim() : ''
        if (typeof c.id !== 'string' || c.id === '' || c.id.length > 60 || textValue === '' || textValue.length > 1000) {
          errors.push(`conditions[${index}] needs an id and text (text up to 1000 characters).`); return
        }
        parsed.push({
          id: c.id, text: textValue,
          ...(typeof c.frequency === 'string' && c.frequency.trim() ? { frequency: c.frequency.trim().slice(0, 100) } : {}),
          ...(typeof c.ref === 'string' && c.ref.trim() ? { ref: c.ref.trim().slice(0, 200) } : {}),
        })
      })
      conditions = parsed
    }
  }

  let documentPath = current?.documentPath ?? null
  if (has('document_path')) {
    const v = body.document_path
    if (v === null || v === '') documentPath = null
    else if (typeof v === 'string' && v.length <= 300 && v.startsWith(options.documentPathPrefix) && !v.includes('..')) documentPath = v
    else errors.push('document_path must be a file you uploaded to this account.')
  }

  const permit: PermitInput = {
    facilityId,
    program:         enumOf('program', PERMIT_PROGRAMS, current?.program ?? ('' as PermitProgram)),
    permitType:      permitType ?? '',
    permitNumber:    text('permit_number', 100, current?.permitNumber ?? null),
    issuingAgency:   text('issuing_agency', 200, current?.issuingAgency ?? null),
    jurisdiction,
    status:          enumOf('status', PERMIT_STATUSES, current?.status ?? 'draft'),
    effectiveDate,
    expirationDate,
    renewalLeadDays,
    identifiers,
    conditions,
    documentPath,
    notes:           text('notes', 2000, current?.notes ?? null),
  }
  if (!permit.program && !errors.some(e => e.startsWith('program'))) errors.push(`program is required: one of ${PERMIT_PROGRAMS.join(', ')}.`)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, permit }
}

// ── the renewal deadline a permit implies ───────────────────────────────────

export interface ExistingRenewal {
  id:          string
  status:      'open' | 'completed' | 'dismissed'
  nextDueAt:   string
  title:       string
}

export type RenewalAction =
  | { type: 'none' }
  | { type: 'create'; planned: PlannedObligation }
  | { type: 'update'; id: string; planned: PlannedObligation }
  | { type: 'dismiss'; id: string }

/**
 * What the calendar should do about a permit's renewal deadline now that the
 * permit changed. A deadline a person already completed or dismissed is left
 * alone; an open one follows the permit's expiration date; one whose permit is
 * no longer in force (or has no expiration date) is dismissed rather than left
 * to nag.
 */
export function decideRenewalAction(planned: PlannedObligation | null, existing: ExistingRenewal | null): RenewalAction {
  if (!existing) return planned ? { type: 'create', planned } : { type: 'none' }
  if (existing.status !== 'open') return { type: 'none' }
  if (!planned) return { type: 'dismiss', id: existing.id }
  const unchanged = existing.nextDueAt === planned.next_due_at && existing.title === planned.title
  return unchanged ? { type: 'none' } : { type: 'update', id: existing.id, planned }
}

// ── table <-> domain ────────────────────────────────────────────────────────

/** The permit as table columns. The inverse of parsePermitRow. */
export function toPermitRow(permit: PermitInput): Record<string, unknown> {
  return {
    facility_id:       permit.facilityId,
    program:           permit.program,
    permit_type:       permit.permitType,
    permit_number:     permit.permitNumber,
    issuing_agency:    permit.issuingAgency,
    jurisdiction:      permit.jurisdiction,
    status:            permit.status,
    effective_date:    permit.effectiveDate,
    expiration_date:   permit.expirationDate,
    renewal_lead_days: permit.renewalLeadDays,
    identifiers:       permit.identifiers,
    conditions:        permit.conditions,
    document_path:     permit.documentPath,
    notes:             permit.notes,
  }
}

/** A stored permit row as the domain object, used as `current` for a partial update. */
export function parsePermitRow(row: Record<string, unknown>): PermitInput {
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    facilityId:      String(row.facility_id),
    program:         row.program as PermitProgram,
    permitType:      String(row.permit_type ?? ''),
    permitNumber:    str(row.permit_number),
    issuingAgency:   str(row.issuing_agency),
    jurisdiction:    str(row.jurisdiction),
    status:          row.status as PermitStatus,
    effectiveDate:   str(row.effective_date),
    expirationDate:  str(row.expiration_date),
    renewalLeadDays: typeof row.renewal_lead_days === 'number' ? row.renewal_lead_days : DEFAULT_RENEWAL_LEAD_DAYS,
    identifiers:     (typeof row.identifiers === 'object' && row.identifiers !== null && !Array.isArray(row.identifiers) ? row.identifiers : {}) as Record<string, string>,
    conditions:      Array.isArray(row.conditions) ? (row.conditions as PermitCondition[]) : [],
    documentPath:    str(row.document_path),
    notes:           str(row.notes),
  }
}
