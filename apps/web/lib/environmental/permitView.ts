import { daysUntilDue } from '@soteria/core/complianceCalendar'
import {
  DEFAULT_RENEWAL_LEAD_DAYS, planPermitRenewal,
  type PermitCondition, type PermitProgram, type PermitStatus,
} from '@soteria/core/environmental/permits'
import { ENV_PROGRAM_LABELS } from '@soteria/core/environmental/siteProfile'
import type { Permit, PermitHealthState } from './client'

// What the permits screen shows and sends, as pure functions: the wording of a
// permit's health, its sort order, and the form <-> request-body translation.
// "Now" is always an input, so the same permit reads the same in a test.

type Tone = 'good' | 'warn' | 'bad' | 'idle'

/** How each health state looks and where it sorts: the most urgent first. */
export const PERMIT_HEALTH_META: Readonly<Record<PermitHealthState, { label: string; tone: Tone; urgencyRank: number }>> = {
  expired:     { label: 'Expired',     tone: 'bad',  urgencyRank: 0 },
  expiring:    { label: 'Expiring',    tone: 'warn', urgencyRank: 1 },
  active:      { label: 'Active',      tone: 'good', urgencyRank: 2 },
  not_tracked: { label: 'Not tracked', tone: 'idle', urgencyRank: 3 },
}

export const PERMIT_PROGRAM_LABELS: Readonly<Record<PermitProgram, string>> = {
  stormwater:      ENV_PROGRAM_LABELS.stormwater,
  air:             ENV_PROGRAM_LABELS.air,
  wastewater:      ENV_PROGRAM_LABELS.wastewater,
  hazardous_waste: ENV_PROGRAM_LABELS.hazardous_waste,
  spcc:            ENV_PROGRAM_LABELS.spcc,
  other:           'Other',
}

export const PERMIT_STATUS_LABELS: Readonly<Record<PermitStatus, string>> = {
  draft:               'Draft',
  application_pending: 'Application pending',
  active:              'Active',
  expired:             'Expired',
  terminated:          'Terminated',
  not_required:        'Not required',
}

// The API types these as plain strings; the database constrains them to the
// catalogs above, so the narrowing is made here, once.
export const permitProgramLabel = (program: string): string => PERMIT_PROGRAM_LABELS[program as PermitProgram]
const permitStatusLabel = (status: string): string => PERMIT_STATUS_LABELS[status as PermitStatus]

/** "NPDES Industrial General Permit CAS000001": the same label the calendar's renewal deadline uses. */
export const permitLabel = (permit: Pick<Permit, 'permit_type' | 'permit_number'>): string =>
  permit.permit_number ? `${permit.permit_type} ${permit.permit_number}` : permit.permit_type

export function jurisdictionLabel(jurisdiction: string | null): string | null {
  if (jurisdiction === null) return null
  return jurisdiction === 'federal' ? 'Federal' : `State (${jurisdiction})`
}

/**
 * The jurisdictions a permit at this site can name. A permit already carrying
 * another value keeps it as a choice, so editing it does not silently change it.
 */
export function jurisdictionOptions(siteState: string | null, current: string): Array<{ value: string; label: string }> {
  const values = ['', 'federal', ...(siteState ? [siteState] : []), ...(current ? [current] : [])]
  return [...new Set(values)].map(value => ({ value, label: jurisdictionLabel(value || null) ?? 'Not specified' }))
}

// ── where a permit stands ───────────────────────────────────────────────────

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? '' : 's'}`

function expiryPhrase(days: number | null): string {
  if (days === null) return 'No expiration date'
  return days === 0 ? 'Expires today' : `Expires in ${plural(days, 'day')}`
}

/** One line saying why the health chip reads as it does, from the API's health and the dates. */
export function permitHealthText(permit: Permit, nowMs: number): string {
  const days = permit.expiration_date === null ? null : daysUntilDue(permit.expiration_date, new Date(nowMs))
  switch (permit.health) {
    case 'expired':
      return days !== null && days < 0 ? `Expired ${plural(-days, 'day')} ago` : 'Marked as expired'
    case 'expiring':
      return `${expiryPhrase(days)}; renewal window open`
    case 'active':
      return days === null ? expiryPhrase(null) : `${expiryPhrase(days)}; renewal window opens in ${plural(days - permit.renewal_lead_days, 'day')}`
    case 'not_tracked':
      return `Not tracked: status is ${permitStatusLabel(permit.status).toLowerCase()}`
  }
}

/**
 * The date the permit's renewal deadline falls on the calendar, or null when it
 * has none. Asks the same core rule the server uses to create that deadline, so
 * this screen cannot disagree with the calendar.
 */
export function renewalDeadline(permit: Permit): string | null {
  return planPermitRenewal({
    id: permit.id, facilityId: permit.facility_id, program: permit.program as PermitProgram,
    permitType: permit.permit_type, permitNumber: permit.permit_number, status: permit.status,
    expirationDate: permit.expiration_date, renewalLeadDays: permit.renewal_lead_days,
  })?.next_due_at ?? null
}

// A permit with no expiration date has nothing to be urgent about, so it sorts last.
const compareExpiration = (a: string | null, b: string | null): number => {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

/** Most urgent first: expired, expiring, active, not tracked; then soonest expiration, then name. */
export function sortPermitsByUrgency(permits: readonly Permit[]): Permit[] {
  return [...permits].sort((a, b) =>
    PERMIT_HEALTH_META[a.health].urgencyRank - PERMIT_HEALTH_META[b.health].urgencyRank
    || compareExpiration(a.expiration_date, b.expiration_date)
    || permitLabel(a).localeCompare(permitLabel(b))
    || a.id.localeCompare(b.id))
}

// ── the form ────────────────────────────────────────────────────────────────

export interface ConditionRow { id: string; text: string; frequency: string; reference: string }
export interface IdentifierRow { name: string; value: string }

export interface PermitFormState {
  program:         PermitProgram | ''
  permitType:      string
  permitNumber:    string
  issuingAgency:   string
  jurisdiction:    string
  status:          PermitStatus
  effectiveDate:   string
  expirationDate:  string
  renewalLeadDays: string
  identifiers:     IdentifierRow[]
  conditions:      ConditionRow[]
  documentPath:    string | null
  notes:           string
}

export function blankPermitForm(): PermitFormState {
  return {
    program: '', permitType: '', permitNumber: '', issuingAgency: '', jurisdiction: '',
    // A permit being recorded is usually one in force; "draft" would quietly leave it off the calendar.
    status: 'active', effectiveDate: '', expirationDate: '', renewalLeadDays: String(DEFAULT_RENEWAL_LEAD_DAYS),
    identifiers: [], conditions: [], documentPath: null, notes: '',
  }
}

/** A new condition needs an id that survives edits; the caller supplies it (a UUID in the browser). */
export const blankConditionRow = (id: string): ConditionRow => ({ id, text: '', frequency: '', reference: '' })

export function permitToForm(permit: Permit): PermitFormState {
  return {
    program:         permit.program as PermitProgram,
    permitType:      permit.permit_type,
    permitNumber:    permit.permit_number ?? '',
    issuingAgency:   permit.issuing_agency ?? '',
    jurisdiction:    permit.jurisdiction ?? '',
    status:          permit.status as PermitStatus,
    effectiveDate:   permit.effective_date ?? '',
    expirationDate:  permit.expiration_date ?? '',
    renewalLeadDays: String(permit.renewal_lead_days),
    identifiers:     Object.entries(permit.identifiers).map(([name, value]) => ({ name, value })),
    conditions:      permit.conditions.map(c => ({ id: c.id, text: c.text, frequency: c.frequency ?? '', reference: c.ref ?? '' })),
    documentPath:    permit.document_path,
    notes:           permit.notes ?? '',
  }
}

// A type alias, not an interface: the API client takes a Record<string, unknown>.
export type PermitRequestBody = {
  program:           PermitProgram
  permit_type:       string
  permit_number:     string | null
  issuing_agency:    string | null
  jurisdiction:      string | null
  status:            PermitStatus
  effective_date:    string | null
  expiration_date:   string | null
  renewal_lead_days: number
  identifiers:       Record<string, string>
  conditions:        PermitCondition[]
  document_path:     string | null
  notes:             string | null
}

export type PermitRequest =
  | { ok: true; body: PermitRequestBody }
  | { ok: false; errors: string[] }

const orNull = (text: string): string | null => text.trim() || null
const isBlank = (...texts: string[]): boolean => texts.every(t => t.trim() === '')

// Only what the form cannot express in a request is checked here: a missing
// program has no body to send, and a half-filled row has no honest reading
// (dropping it would lose what was typed; sending it would invent a blank).
// Everything else the API judges, and its words are shown as written.
function formProblems(form: PermitFormState): string[] {
  const problems: string[] = []
  if (form.program === '') problems.push('Choose a program.')
  if (!/^\d+$/.test(form.renewalLeadDays.trim())) problems.push('Renewal lead time must be a whole number of days.')

  const seen = new Set<string>()
  const repeated = new Set<string>()
  form.identifiers.forEach((row, index) => {
    if (isBlank(row.name, row.value)) return
    if (isBlank(row.name) || isBlank(row.value)) { problems.push(`Identifier ${index + 1} needs both a name and a value.`); return }
    const name = row.name.trim()
    if (seen.has(name)) repeated.add(name)
    seen.add(name)
  })
  repeated.forEach(name => problems.push(`The identifier name "${name}" is used more than once.`))
  form.conditions.forEach((row, index) => {
    if (!isBlank(row.frequency, row.reference) && isBlank(row.text)) problems.push(`Condition ${index + 1} needs text.`)
  })
  return problems
}

function toCondition(row: ConditionRow): PermitCondition {
  const frequency = orNull(row.frequency)
  const ref = orNull(row.reference)
  return { id: row.id, text: row.text.trim(), ...(frequency ? { frequency } : {}), ...(ref ? { ref } : {}) }
}

/** The request for the API from the form, or what to fix first. Blank rows are dropped; text is trimmed. */
export function buildPermitRequest(form: PermitFormState): PermitRequest {
  const problems = formProblems(form)
  // An unchosen program is already a problem; it is tested again only so the type narrows.
  if (problems.length > 0 || form.program === '') return { ok: false, errors: problems }

  return {
    ok: true,
    body: {
      program:           form.program,
      permit_type:       form.permitType.trim(),
      permit_number:     orNull(form.permitNumber),
      issuing_agency:    orNull(form.issuingAgency),
      jurisdiction:      orNull(form.jurisdiction),
      status:            form.status,
      effective_date:    orNull(form.effectiveDate),
      expiration_date:   orNull(form.expirationDate),
      renewal_lead_days: Number(form.renewalLeadDays.trim()),
      identifiers:       Object.fromEntries(form.identifiers.filter(r => !isBlank(r.name, r.value)).map(r => [r.name.trim(), r.value.trim()])),
      conditions:        form.conditions.filter(c => !isBlank(c.text, c.frequency, c.reference)).map(toCondition),
      document_path:     form.documentPath,
      notes:             orNull(form.notes),
    },
  }
}
