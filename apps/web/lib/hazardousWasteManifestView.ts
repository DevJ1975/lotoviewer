import {
  MANIFEST_TRANSITIONS, isValidEpaId, manifestClockRule, manifestJurisdictionFor,
  type HazardousWasteShipmentRow, type ManifestAction, type ManifestClockStage, type ManifestDraftFields, type ManifestReturnClock,
  type ManifestStatus,
} from '@soteria/core/hazardousWasteManifest'
import type { HazardousWasteContainerStatus, HazardousWasteFacilityProfile, RcraGeneratorCategory } from '@soteria/core/hazardousWaste'

// What the manifest screens and the /api/hazardous-waste/manifests routes share: the shapes
// the routes answer with, and the words and colours the screens put on them. The rules
// themselves (the clock, the legal moves) are @soteria/core's.

/** A container as a manifest lists it. */
export interface ManifestContainerRef {
  id:     string
  label:  string
  status: HazardousWasteContainerStatus
  /** The waste stream's name, on the detail view. */
  stream_name?: string | null
}

export interface ManifestListItem extends HazardousWasteShipmentRow {
  containers: ManifestContainerRef[]
  clock:      ManifestReturnClock
}

export interface ManifestDetail extends ManifestListItem {
  /** Three years after shipping; null until it ships. */
  retention_end: string | null
  /** Whether this caller may edit or move it: its creator, or a tenant admin. */
  can_modify:    boolean
}

/** A closed container that could go on a new manifest. */
export interface ShippableContainer {
  id:                      string
  label:                   string
  area_location:           string | null
  volume_quantity:         number | null
  volume_unit:             string | null
  accumulation_started_at: string | null
  stream: { id: string; name: string; waste_codes: string[] } | null
}

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'

/** The creator may edit and move their own manifest; an admin may edit and move anyone's. RLS holds the same rule. */
export function canModifyManifest(role: Role, userId: string, createdBy: string | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'superadmin' || (createdBy !== null && createdBy === userId)
}

export const MANIFEST_STATUS_LABEL: Record<ManifestStatus, string> = {
  draft:              'Draft',
  shipped:            'Shipped',
  completed:          'Completed',
  exception_reported: 'Exception reported',
  cancelled:          'Cancelled',
}

export const GENERATOR_CATEGORY_LABEL: Record<RcraGeneratorCategory, string> = {
  lqg:  'LQG: large quantity generator',
  sqg:  'SQG: small quantity generator',
  vsqg: 'VSQG: very small quantity generator',
}

/** 'federal' as "Federal (40 CFR)", 'state:CA' as "State rules: CA". */
export function jurisdictionLabel(jurisdiction: string): string {
  return jurisdiction === 'federal' ? 'Federal (40 CFR)' : `State rules: ${jurisdiction.slice('state:'.length)}`
}

export const CONTAINER_STATUS_LABEL: Record<HazardousWasteContainerStatus, string> = {
  open:        'Open',
  closed:      'Closed',
  in_shipment: 'In shipment',
  disposed:    'Disposed',
}

export const MANIFEST_STAGE_LABEL: Record<ManifestClockStage, string> = {
  draft:                'Draft',
  on_track:             'On track',
  follow_up_due:        'Follow up now',
  exception_report_due: 'Exception report due',
  completed:            'Signed copy received',
  exception_reported:   'Exception report filed',
  cancelled:            'Cancelled',
  not_applicable:       'No return clock',
}

/** Colour is never the only signal: every stage also has its words. */
export const MANIFEST_STAGE_TONE: Record<ManifestClockStage, string> = {
  draft:                'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  on_track:             'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  follow_up_due:        'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  exception_report_due: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  completed:            'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  exception_reported:   'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  cancelled:            'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  not_applicable:       'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

export const MANIFEST_ACTION_LABEL: Record<ManifestAction, string> = {
  ship:           'Ship',
  receive:        'Record signed copy',
  file_exception: 'File exception report',
  cancel:         'Cancel manifest',
}

/** The button that carries an action out, once its effect has been read. Not the same words as the one that opens it. */
export const MANIFEST_ACTION_CONFIRM_LABEL: Record<ManifestAction, string> = {
  ship:           'Confirm shipment',
  receive:        'Confirm signed copy received',
  file_exception: 'Confirm exception report',
  cancel:         'Confirm cancellation',
}

/** What the date an action asks for is called. Null where it asks for none. */
export const MANIFEST_ACTION_DATE_LABEL: Record<ManifestAction, string | null> = {
  ship:           'Date the transporter accepted the waste',
  receive:        'Date the signed copy was received',
  file_exception: 'Date the exception report was filed',
  cancel:         null,
}

/**
 * The chip on a manifest: "Day 36 of 45 · Follow up now" while the clock runs, the stage
 * alone once it has stopped or never started.
 */
export function clockChipText(item: Pick<ManifestListItem, 'clock' | 'generator_category' | 'jurisdiction'>): string {
  const { clock } = item
  const rule = manifestClockRule(item.generator_category, item.jurisdiction)
  if (clock.daysSinceShipped === null || rule === null) return MANIFEST_STAGE_LABEL[clock.stage]
  return `Day ${clock.daysSinceShipped} of ${rule.exceptionReportDay} · ${MANIFEST_STAGE_LABEL[clock.stage]}`
}

/** Says, in the words a person would use, what an action will do to the manifest's containers. */
export function containerEffectText(action: ManifestAction, containerCount: number): string {
  const many = containerCount !== 1
  const subject = `The ${containerCount} container${many ? 's' : ''}`
  const stay = many ? 'stay' : 'stays'
  const become = many ? 'become' : 'becomes'
  const go = many ? 'go' : 'goes'
  const after = MANIFEST_TRANSITIONS[action].containersAfter
  if (after === null) return `${subject} ${stay} In shipment.`
  if (after === 'disposed') return `${subject} ${become} Disposed and leave${many ? '' : 's'} the active container list.`
  return `${subject} ${go} back to ${CONTAINER_STATUS_LABEL[after]} and can go on another manifest.`
}

export interface TimelineEntry { key: string; label: string; date: string | null }

/** The manifest's life in order. A step not yet taken has no date. */
export function timelineEntries(row: Pick<HazardousWasteShipmentRow, 'status' | 'created_at' | 'updated_at' | 'shipped_on' | 'completed_on' | 'exception_reported_on'>): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { key: 'drafted', label: 'Drafted', date: row.created_at.slice(0, 10) },
    { key: 'shipped', label: 'Shipped: transporter accepted the waste', date: row.shipped_on },
  ]
  if (row.status === 'exception_reported') {
    entries.push({ key: 'exception', label: 'Exception report filed', date: row.exception_reported_on })
  } else if (row.status !== 'cancelled') {
    entries.push({ key: 'completed', label: 'Signed copy received', date: row.completed_on })
  }
  // A cancelled manifest cannot be edited, so its last update is the day it was cancelled.
  if (row.status === 'cancelled') entries.push({ key: 'cancelled', label: 'Cancelled', date: row.updated_at.slice(0, 10) })
  return entries
}

/** A YYYY-MM-DD for people: "5 Apr 2026". The day is read as written, never shifted by the viewer's zone. */
export function formatDay(day: string | null): string {
  if (!day) return '—'
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Today in the viewer's own calendar, as YYYY-MM-DD: the latest a date field should offer. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// ── The details form ────────────────────────────────────────────────────────

/** The manifest form as people type it: everything text, so a half-finished entry is not rejected as they go. */
export interface ManifestFormValues {
  generatorCategory: RcraGeneratorCategory | ''
  jurisdictionKind:  'federal' | 'state'
  /** Two letters, when the rules are a state's. */
  stateCode:         string
  trackingNumber:    string
  generatorEpaId:    string
  transporterName:   string
  transporterEpaId:  string
  tsdfName:          string
  tsdfEpaId:         string
  /** Separated by commas or spaces. */
  wasteCodes:        string
  dotDescription:    string
  electronic:        boolean
  notes:             string
}

export const EMPTY_MANIFEST_FORM: ManifestFormValues = {
  generatorCategory: '', jurisdictionKind: 'federal', stateCode: '', trackingNumber: '', generatorEpaId: '',
  transporterName: '', transporterEpaId: '', tsdfName: '', tsdfEpaId: '', wasteCodes: '', dotDescription: '',
  electronic: false, notes: '',
}

/** The API field each form field reports its errors under. */
export const MANIFEST_FORM_API_FIELD: Record<keyof ManifestFormValues, string> = {
  generatorCategory: 'generator_category', jurisdictionKind: 'jurisdiction', stateCode: 'jurisdiction',
  trackingNumber: 'manifest_tracking_number', generatorEpaId: 'generator_epa_id', transporterName: 'transporter_name',
  transporterEpaId: 'transporter_epa_id', tsdfName: 'tsdf_name', tsdfEpaId: 'tsdf_epa_id', wasteCodes: 'waste_codes',
  dotDescription: 'dot_description', electronic: 'electronic', notes: 'notes',
}

export function splitWasteCodes(text: string): string[] {
  return text.split(/[\s,;]+/).filter(code => code !== '')
}

/** The request body for a create or an edit. Blank text is sent blank; the route reads it as "none". */
export function manifestFormToBody(values: ManifestFormValues): Record<string, unknown> {
  return {
    generator_category:       values.generatorCategory,
    jurisdiction:             values.jurisdictionKind === 'federal' ? 'federal' : `state:${values.stateCode.trim().toUpperCase()}`,
    manifest_tracking_number: values.trackingNumber.trim(),
    generator_epa_id:         values.generatorEpaId.trim(),
    transporter_name:         values.transporterName.trim(),
    transporter_epa_id:       values.transporterEpaId.trim(),
    tsdf_name:                values.tsdfName.trim(),
    tsdf_epa_id:              values.tsdfEpaId.trim(),
    waste_codes:              splitWasteCodes(values.wasteCodes),
    dot_description:          values.dotDescription.trim(),
    electronic:               values.electronic,
    notes:                    values.notes.trim(),
  }
}

export function manifestFormFromRow(row: ManifestDraftFields): ManifestFormValues {
  const isState = row.jurisdiction !== 'federal'
  return {
    generatorCategory: row.generator_category,
    jurisdictionKind:  isState ? 'state' : 'federal',
    stateCode:         isState ? row.jurisdiction.slice('state:'.length) : '',
    trackingNumber:    row.manifest_tracking_number ?? '',
    generatorEpaId:    row.generator_epa_id ?? '',
    transporterName:   row.transporter_name ?? '',
    transporterEpaId:  row.transporter_epa_id ?? '',
    tsdfName:          row.tsdf_name ?? '',
    tsdfEpaId:         row.tsdf_epa_id ?? '',
    wasteCodes:        row.waste_codes.join(', '),
    dotDescription:    row.dot_description ?? '',
    electronic:        row.electronic,
    notes:             row.notes ?? '',
  }
}

/**
 * A new manifest starts from the site's own generator profile, when it has one. Nothing is
 * guessed past that: with no profile the category is left for the person to choose, because
 * it sets the return clock.
 */
export function manifestFormDefaults(profile: HazardousWasteFacilityProfile | null): ManifestFormValues {
  if (!profile) return { ...EMPTY_MANIFEST_FORM }
  const jurisdiction = profile.jurisdiction ? manifestJurisdictionFor(profile.jurisdiction) : 'federal'
  return {
    ...EMPTY_MANIFEST_FORM,
    generatorCategory: profile.generator_category ?? '',
    jurisdictionKind:  jurisdiction === 'federal' ? 'federal' : 'state',
    stateCode:         jurisdiction === 'federal' ? '' : jurisdiction.slice('state:'.length),
    generatorEpaId:    profile.epa_id_number && isValidEpaId(profile.epa_id_number) ? profile.epa_id_number.trim().toUpperCase() : '',
  }
}
