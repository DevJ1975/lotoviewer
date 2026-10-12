// Pure logic for hazardous-waste manifests (shipments). No I/O, no DOM, no clock:
// callers pass `now`, so the same input always gives the same answer.
//
// A manifest is the paper (or e-Manifest) trail for one shipment of closed containers.
// What the generator owes after the waste leaves is the signed copy back from the
// receiving facility; manifestReturnClock says how long that has taken and what is due.
//
// Dates are plain YYYY-MM-DD calendar days, never instants, and all arithmetic is in
// UTC so a day count never drifts with the server's or the browser's zone.
//
// The regulatory figures here have not been confirmed against current text. Each is
// listed in MANIFEST_CITATIONS with what to check; a CSP should confirm them before a
// client relies on them for a deadline.

import type { Citation } from './environmental/content'
import type {
  FieldError, HazardousWasteContainerStatus, RcraGeneratorCategory, WasteJurisdiction,
} from './hazardousWaste'
import { classifyWasteCode } from './wasteCodes'

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const MANIFEST_STATUSES = ['draft', 'shipped', 'completed', 'exception_reported', 'cancelled'] as const
export type ManifestStatus = typeof MANIFEST_STATUSES[number]

export const MANIFEST_ACTIONS = ['ship', 'receive', 'file_exception', 'cancel'] as const
export type ManifestAction = typeof MANIFEST_ACTIONS[number]

/** 'federal', or 'state:' and the USPS code, e.g. 'state:CA'. Matches the column's check. */
export type ManifestJurisdiction = 'federal' | `state:${string}`

const JURISDICTION_RE = /^(federal|state:[A-Z]{2})$/

/** A status after which nothing more happens to the manifest. */
export const MANIFEST_STATUS_IS_TERMINAL: Record<ManifestStatus, boolean> = {
  draft:              false,
  shipped:            false,
  completed:          true,
  exception_reported: true,
  cancelled:          true,
}

/**
 * What each action does. The database enforces the same table (hw_transition_shipment,
 * migration 317) and a test walks every status against every action to keep the two
 * agreeing; this copy is what the screens read to offer only legal actions.
 */
export interface ManifestTransitionRule {
  from: readonly ManifestStatus[]
  to: ManifestStatus
  /** The date the person enters, and the column it fills. Null when no date is asked for. */
  dateMeaning: 'shipped_on' | 'completed_on' | 'exception_reported_on' | null
  /** What the manifest's containers become. Null leaves them as they are. */
  containersAfter: HazardousWasteContainerStatus | null
}

export const MANIFEST_TRANSITIONS: Record<ManifestAction, ManifestTransitionRule> = {
  ship:           { from: ['draft'],            to: 'shipped',            dateMeaning: 'shipped_on',            containersAfter: null },
  receive:        { from: ['shipped'],          to: 'completed',          dateMeaning: 'completed_on',          containersAfter: 'disposed' },
  file_exception: { from: ['shipped'],          to: 'exception_reported', dateMeaning: 'exception_reported_on', containersAfter: null },
  cancel:         { from: ['draft', 'shipped'], to: 'cancelled',          dateMeaning: null,                    containersAfter: 'closed' },
}

/** The actions a manifest in this status can take, in the order the screens list them. */
export function availableManifestActions(status: ManifestStatus): ManifestAction[] {
  return MANIFEST_ACTIONS.filter(action => MANIFEST_TRANSITIONS[action].from.includes(status))
}

/** The columns a person fills in. A draft can change any of them; a shipped manifest none. */
export interface ManifestDraftFields {
  manifest_tracking_number: string | null
  jurisdiction:             ManifestJurisdiction
  /** The category the site shipped under that day. It is not recomputed later: the return clock keeps using it. */
  generator_category:       RcraGeneratorCategory
  generator_epa_id:         string | null
  transporter_epa_id:       string | null
  tsdf_epa_id:              string | null
  transporter_name:         string | null
  tsdf_name:                string | null
  waste_codes:              string[]
  dot_description:          string | null
  /** Submitted through EPA's e-Manifest rather than on paper. */
  electronic:               boolean
  notes:                    string | null
}

/** A hazardous_waste_shipments row (migration 317). */
export interface HazardousWasteShipmentRow extends ManifestDraftFields {
  id:                    string
  tenant_id:             string
  facility_id:           string
  status:                ManifestStatus
  shipped_on:            string | null
  completed_on:          string | null
  exception_reported_on: string | null
  created_by:            string | null
  created_at:            string
  updated_at:            string
}

// ── Citations ───────────────────────────────────────────────────────────────

export const MANIFEST_CITATIONS = {
  returnClock: {
    ref: '40 CFR 262.42',
    title: 'Exception reporting',
    verify: 'Confirm against current text: an LQG that has no signed copy within 35 days of the initial transporter accepting the waste must contact the transporter and the receiving facility, and within 45 days submit an exception report; an SQG has 60 days and files a copy of the manifest marked as unconfirmed rather than the LQG report. Confirm each figure and what the SQG filing must contain, and the state rule where the state has its own.',
  },
  vsqg: {
    ref: '40 CFR 262.14',
    title: 'Conditions for exemption for a very small quantity generator',
    verify: 'Confirm that a federal VSQG has no manifest return tracking. California did not adopt the VSQG exemption and holds a VSQG to the SQG rules (see WasteJurisdiction in hazardousWaste.ts); no other state is encoded here, so a VSQG elsewhere is shown as not applicable until its state rule is confirmed.',
  },
  retention: {
    ref: '40 CFR 262.40(a)',
    title: 'Recordkeeping: manifests',
    verify: 'Confirm the three-year retention from the date the initial transporter accepted the waste. States may require longer; confirm the state period.',
  },
  trackingNumber: {
    ref: 'EPA Form 8700-22',
    title: 'Uniform Hazardous Waste Manifest',
    verify: 'Confirm the manifest tracking number format: nine digits followed by a three-letter suffix.',
  },
  epaId: {
    ref: '40 CFR 262.12',
    title: 'EPA identification numbers',
    verify: 'Confirm the EPA ID format: three letters followed by nine digits. A state-issued ID that does not fit would be refused here.',
  },
  texasWasteCode: {
    ref: '30 TAC Chapter 335, Subchapter R',
    title: 'Texas waste classification and coding',
    verify: 'Confirm the TCEQ waste code format: a four-digit sequence number, a three-digit form code, and one classification character (H hazardous, 1, 2 or 3 for the nonhazardous classes).',
  },
} as const satisfies Record<string, Citation>

// ── Identifiers ─────────────────────────────────────────────────────────────

const canonical = (value: string): string => value.trim().toUpperCase()

export const MANIFEST_TRACKING_NUMBER_RE = /^[0-9]{9}[A-Z]{3}$/
export const EPA_ID_RE = /^[A-Z]{3}[0-9]{9}$/
const TEXAS_WASTE_CODE_RE = /^[0-9]{4}[0-9]{3}[H123]$/

export function normalizeTrackingNumber(value: string): string { return canonical(value) }
export function normalizeEpaId(value: string): string { return canonical(value) }

export function isValidTrackingNumber(value: string): boolean {
  return MANIFEST_TRACKING_NUMBER_RE.test(normalizeTrackingNumber(value))
}

export function isValidEpaId(value: string): boolean {
  return EPA_ID_RE.test(normalizeEpaId(value))
}

/** Eight characters: 4-digit sequence number, 3-digit form code, then H, 1, 2 or 3. */
export function isTexasWasteCode(value: string): boolean {
  return TEXAS_WASTE_CODE_RE.test(canonical(value))
}

/** A code a manifest may list: federal (D/F/K/P/U), California's three digits, or Texas's eight characters. */
export function isManifestWasteCode(value: string): boolean {
  return classifyWasteCode(value).valid || isTexasWasteCode(value)
}

/** Upper-cased, blanks dropped, repeats dropped, first-seen order kept. */
export function normalizeWasteCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const code of codes) {
    const normalized = canonical(code)
    if (normalized) seen.add(normalized)
  }
  return [...seen]
}

/** The manifest jurisdiction for a stream or facility profile's: California's rules are the state:CA ones. */
export function manifestJurisdictionFor(jurisdiction: WasteJurisdiction): ManifestJurisdiction {
  return jurisdiction === 'california' ? 'state:CA' : 'federal'
}

// ── Calendar days ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

/** A YYYY-MM-DD that names a real day, as UTC milliseconds; null otherwise (2026-02-30 is not a day). */
function parseCalendarDay(value: string | null): number | null {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const ms = Date.UTC(year, month - 1, day)
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null
}

const formatCalendarDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** True for a YYYY-MM-DD that names a real calendar day. */
export function isCalendarDay(value: string): boolean {
  return parseCalendarDay(value) !== null
}

/**
 * The last day the signed copy must be kept: three years after the waste shipped
 * (40 CFR 262.40(a); a state may require longer). A 29 February ship date has no
 * anniversary in a common year, and the date rolls to 1 March: the record is never
 * released a day before the true anniversary. Null when there is no ship date.
 */
export function manifestRetentionEnd(shippedOn: string | null): string | null {
  const shippedMs = parseCalendarDay(shippedOn)
  if (shippedMs === null) return null
  const shipped = new Date(shippedMs)
  return formatCalendarDay(Date.UTC(shipped.getUTCFullYear() + 3, shipped.getUTCMonth(), shipped.getUTCDate()))
}

// ── The return clock ────────────────────────────────────────────────────────

/** Days after the waste shipped on which each step falls due. */
export interface ManifestClockRule {
  /** Contact the transporter and the receiving facility. Null where the rule has no such step. */
  followUpDay: number | null
  exceptionReportDay: number
}

const FEDERAL_CLOCK: Record<RcraGeneratorCategory, ManifestClockRule | null> = {
  lqg:  { followUpDay: 35, exceptionReportDay: 45 },
  sqg:  { followUpDay: null, exceptionReportDay: 60 },
  // A federal VSQG is not held to manifest return tracking.
  vsqg: null,
}

/** Jurisdictions that hold a VSQG to the SQG rules: California did not adopt the VSQG exemption. */
const VSQG_HELD_AS_SQG: readonly ManifestJurisdiction[] = ['state:CA']

/** The clock a manifest runs on, or null when the generator is not held to one. */
export function manifestClockRule(
  generatorCategory: RcraGeneratorCategory,
  jurisdiction: ManifestJurisdiction,
): ManifestClockRule | null {
  const category = generatorCategory === 'vsqg' && VSQG_HELD_AS_SQG.includes(jurisdiction) ? 'sqg' : generatorCategory
  return FEDERAL_CLOCK[category]
}

export type ManifestClockStage =
  | 'draft' | 'on_track' | 'follow_up_due' | 'exception_report_due'
  | 'completed' | 'exception_reported' | 'cancelled' | 'not_applicable'

export interface ManifestClockInput {
  generatorCategory:   RcraGeneratorCategory
  jurisdiction:        ManifestJurisdiction
  status:              ManifestStatus
  shippedOn:           string | null
  completedOn:         string | null
  exceptionReportedOn: string | null
  now:                 Date
}

export interface ManifestReturnClock {
  stage: ManifestClockStage
  /** Whether the generator is held to a return clock at all (false for a federal VSQG). */
  applicable: boolean
  /** Whole days since the waste shipped; null unless the manifest is open and clocked. */
  daysSinceShipped: number | null
  /** The day the generator must contact the transporter and receiving facility. LQG only. */
  followUpOn: string | null
  exceptionReportDueOn: string | null
  /**
   * Days until the next step falls due, counting the day it falls due as 0: the follow-up
   * while one is still ahead, otherwise the exception report. Negative once that report is
   * overdue. Null when nothing is pending.
   */
  daysToNextStep: number | null
  note: string
}

const NO_CLOCK = { daysSinceShipped: null, followUpOn: null, exceptionReportDueOn: null, daysToNextStep: null } as const

/**
 * Where a manifest stands against the time allowed for the signed copy to come back.
 *
 * Day 0 is shipped_on, the day the initial transporter accepted the waste; a step "due
 * on day N" falls due ON shipped_on + N, so a manifest shipped 1 March is on day 35 on
 * 5 April. Only an open ('shipped') manifest has a running clock: a draft has not
 * started one, and a completed, exception-reported or cancelled manifest has finished
 * with it, so its status wins whatever the dates say.
 */
export function manifestReturnClock(input: ManifestClockInput): ManifestReturnClock {
  const rule = manifestClockRule(input.generatorCategory, input.jurisdiction)
  const applicable = rule !== null

  switch (input.status) {
    case 'draft':
      return { stage: 'draft', applicable, ...NO_CLOCK, note: 'Draft. The return clock starts on the day the transporter accepts the waste.' }
    case 'completed':
      return { stage: 'completed', applicable, ...NO_CLOCK, note: `Signed copy received${onDate(input.completedOn)}.` }
    case 'exception_reported':
      return { stage: 'exception_reported', applicable, ...NO_CLOCK, note: `Exception report filed${onDate(input.exceptionReportedOn)}.` }
    case 'cancelled':
      return { stage: 'cancelled', applicable, ...NO_CLOCK, note: 'Cancelled. No return clock.' }
    case 'shipped':
      break
  }

  if (!rule) {
    return {
      stage: 'not_applicable', applicable, ...NO_CLOCK,
      note: 'A very small quantity generator is not held to manifest return tracking under the federal rule. Confirm your state\'s rule.',
    }
  }

  const shippedMs = parseCalendarDay(input.shippedOn)
  if (shippedMs === null) {
    return { stage: 'on_track', applicable, ...NO_CLOCK, note: 'The ship date is missing, so the return clock cannot be worked out.' }
  }

  const nowMs = Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate())
  const daysSinceShipped = Math.round((nowMs - shippedMs) / DAY_MS)
  const followUpMs = rule.followUpDay === null ? null : shippedMs + rule.followUpDay * DAY_MS
  const exceptionMs = shippedMs + rule.exceptionReportDay * DAY_MS
  const followUpOn = followUpMs === null ? null : formatCalendarDay(followUpMs)
  const exceptionReportDueOn = formatCalendarDay(exceptionMs)

  const stage: ManifestClockStage =
    daysSinceShipped >= rule.exceptionReportDay ? 'exception_report_due'
    : rule.followUpDay !== null && daysSinceShipped >= rule.followUpDay ? 'follow_up_due'
    : 'on_track'

  // The follow-up is the next step only while it is still ahead.
  const nextStepMs = stage === 'on_track' && followUpMs !== null ? followUpMs : exceptionMs
  const daysToNextStep = Math.round((nextStepMs - nowMs) / DAY_MS)

  return { stage, applicable, daysSinceShipped, followUpOn, exceptionReportDueOn, daysToNextStep, note: clockNote(stage, rule, followUpOn, exceptionReportDueOn) }
}

function onDate(day: string | null): string {
  return day ? ` on ${day}` : ''
}

function clockNote(stage: ManifestClockStage, rule: ManifestClockRule, followUpOn: string | null, exceptionOn: string): string {
  const isLqg = rule.followUpDay !== null
  const filing = isLqg ? 'an exception report' : 'an exception report (for a small quantity generator, a copy of the manifest marked that delivery was not confirmed)'
  switch (stage) {
    case 'on_track':
      return isLqg
        ? `Signed copy due back by ${followUpOn} (day ${rule.followUpDay}). Without it, contact the transporter and receiving facility then, and file ${filing} by ${exceptionOn} (day ${rule.exceptionReportDay}).`
        : `Signed copy due back by ${exceptionOn} (day ${rule.exceptionReportDay}). Without it, file ${filing}.`
    case 'follow_up_due':
      return `No signed copy after ${rule.followUpDay} days. Contact the transporter and the receiving facility to find out where the waste is. File ${filing} by ${exceptionOn} (day ${rule.exceptionReportDay}) if it has not come back.`
    default:
      return `No signed copy after ${rule.exceptionReportDay} days. File ${filing} with the EPA Regional Administrator or the authorized state agency (due ${exceptionOn}).`
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

export const MANIFEST_MAX_CONTAINERS = 100
export const MANIFEST_MAX_WASTE_CODES = 50
export const MANIFEST_NOTE_MAX = 500

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RCRA_CATEGORIES: readonly RcraGeneratorCategory[] = ['lqg', 'sqg', 'vsqg']

/** The problems with the fields that are present; a field left out is not checked (PATCH sends only what changed). */
export function validateManifestFields(fields: Partial<ManifestDraftFields>): FieldError[] {
  const errors: FieldError[] = []
  const tooLong = (field: string, label: string, value: string | null | undefined, max: number) => {
    if (value && value.length > max) errors.push({ field, message: `${label} must be ${max} characters or fewer` })
  }

  if (fields.manifest_tracking_number != null && !isValidTrackingNumber(fields.manifest_tracking_number)) {
    errors.push({ field: 'manifest_tracking_number', message: 'Tracking number must be nine digits followed by three letters, e.g. 123456789ELC' })
  }
  if (fields.jurisdiction !== undefined && !JURISDICTION_RE.test(fields.jurisdiction)) {
    errors.push({ field: 'jurisdiction', message: 'Jurisdiction must be federal or a state such as state:CA' })
  }
  if (fields.generator_category !== undefined && !RCRA_CATEGORIES.includes(fields.generator_category)) {
    errors.push({ field: 'generator_category', message: 'Generator category must be LQG, SQG or VSQG' })
  }
  for (const [field, label] of [
    ['generator_epa_id', 'Generator EPA ID'], ['transporter_epa_id', 'Transporter EPA ID'], ['tsdf_epa_id', 'Receiving facility EPA ID'],
  ] as const) {
    const value = fields[field]
    if (value != null && !isValidEpaId(value)) errors.push({ field, message: `${label} must be three letters followed by nine digits, e.g. CAL000123456` })
  }
  tooLong('transporter_name', 'Transporter name', fields.transporter_name, 200)
  tooLong('tsdf_name', 'Receiving facility name', fields.tsdf_name, 200)
  tooLong('dot_description', 'Shipping description', fields.dot_description, 1000)
  tooLong('notes', 'Notes', fields.notes, 2000)

  if (fields.waste_codes !== undefined) {
    const codes = normalizeWasteCodes(fields.waste_codes)
    if (codes.length > MANIFEST_MAX_WASTE_CODES) {
      errors.push({ field: 'waste_codes', message: `A manifest can list at most ${MANIFEST_MAX_WASTE_CODES} waste codes` })
    }
    const unrecognized = codes.filter(code => !isManifestWasteCode(code))
    if (unrecognized.length > 0) {
      errors.push({ field: 'waste_codes', message: `Not a federal, California or Texas waste code: ${unrecognized.join(', ')}` })
    }
  }
  return errors
}

export interface ManifestCreateInput extends ManifestDraftFields {
  container_ids: string[]
}

export function validateManifestCreateInput(input: ManifestCreateInput): FieldError[] {
  const errors = validateManifestFields(input)
  if (input.container_ids.length === 0) {
    errors.push({ field: 'container_ids', message: 'Choose at least one container' })
  } else if (input.container_ids.length > MANIFEST_MAX_CONTAINERS) {
    errors.push({ field: 'container_ids', message: `A manifest can carry at most ${MANIFEST_MAX_CONTAINERS} containers` })
  } else if (input.container_ids.some(id => !UUID_RE.test(id))) {
    errors.push({ field: 'container_ids', message: 'Container ids must be UUIDs' })
  }
  return errors
}

export interface ManifestTransitionInput {
  action: string
  /** YYYY-MM-DD. Required for the actions that fill a date. */
  on: string | null
  note: string | null
}

/**
 * The problems with a request to move a manifest. Whether the date is in the future, or
 * before the ship date, depends on the stored manifest and the database's clock, so those
 * are the database's to refuse.
 */
export function validateManifestTransitionInput(input: ManifestTransitionInput): FieldError[] {
  const errors: FieldError[] = []
  const action = (MANIFEST_ACTIONS as readonly string[]).includes(input.action) ? input.action as ManifestAction : null
  if (!action) {
    errors.push({ field: 'action', message: `Action must be one of ${MANIFEST_ACTIONS.join(', ')}` })
  } else if (MANIFEST_TRANSITIONS[action].dateMeaning !== null && input.on === null) {
    errors.push({ field: 'on', message: 'Enter the date' })
  }
  if (input.on !== null && !isCalendarDay(input.on)) {
    errors.push({ field: 'on', message: 'Enter the date as YYYY-MM-DD' })
  }
  if (input.note && input.note.length > MANIFEST_NOTE_MAX) {
    errors.push({ field: 'note', message: `Note must be ${MANIFEST_NOTE_MAX} characters or fewer` })
  }
  return errors
}
