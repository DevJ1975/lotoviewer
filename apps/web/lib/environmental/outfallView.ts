import type { OutfallStatus, OutfallType } from '@soteria/core/environmental/outfalls'
import type { Outfall, Permit } from './client'
import { permitLabel } from './permitView'

// What the outfalls screen shows and sends, as pure functions: how an outfall
// reads in a table, which other records it may point to, and the form <->
// request-body translation.

type Tone = 'good' | 'warn' | 'bad' | 'idle'

const isBlank = (text: string): boolean => text.trim() === ''
const orNull = (text: string): string | null => text.trim() || null

export const OUTFALL_TYPE_LABELS: Readonly<Record<OutfallType, string>> = {
  stormwater:     'Stormwater',
  authorized_nsw: 'Authorized non-stormwater',
  combined:       'Combined',
}

export const OUTFALL_STATUS_META: Readonly<Record<OutfallStatus, { label: string; tone: Tone }>> = {
  active:   { label: 'Active',   tone: 'good' },
  inactive: { label: 'Inactive', tone: 'idle' },
  removed:  { label: 'Removed',  tone: 'idle' },
}

// Numeric collation, so OF-2 comes before OF-10; the database sorts as text.
const byCode = (a: Pick<Outfall, 'code'>, b: Pick<Outfall, 'code'>): number =>
  a.code.localeCompare(b.code, undefined, { numeric: true })

export const sortOutfallsByCode = (outfalls: readonly Outfall[]): Outfall[] => [...outfalls].sort(byCode)

export const outfallOptionLabel = (outfall: Pick<Outfall, 'code' | 'name'>): string =>
  outfall.name ? `${outfall.code}: ${outfall.name}` : outfall.code

/** "Same as OF-001" for an outfall that stands in for another's sampling, or null when it stands alone. */
export function representativeOfLabel(outfall: Pick<Outfall, 'substantially_identical_to'>, all: readonly Pick<Outfall, 'id' | 'code'>[]): string | null {
  const representativeId = outfall.substantially_identical_to
  if (representativeId === null) return null
  const representative = all.find(o => o.id === representativeId)
  return representative ? `Same as ${representative.code}` : 'Same as another outfall'
}

/** The outfalls this one may be "substantially identical to": the others at its site, never itself. */
export function otherOutfallsAtSite(outfalls: readonly Outfall[], siteId: string, selfId: string | null): Outfall[] {
  return outfalls.filter(o => o.facility_id === siteId && o.id !== selfId).sort(byCode)
}

/** The permits an outfall may be covered by: the ones at its own site. */
export function permitsAtSite(permits: readonly Permit[], siteId: string): Permit[] {
  return permits.filter(p => p.facility_id === siteId).sort((a, b) => permitLabel(a).localeCompare(permitLabel(b)))
}

export const coordinatesLabel = (outfall: Pick<Outfall, 'latitude' | 'longitude'>): string | null =>
  outfall.latitude === null || outfall.longitude === null ? null : `${outfall.latitude}, ${outfall.longitude}`

/** Where "Inspect" goes, or null for an outfall that has been removed and is no longer walked. */
export function inspectHref(outfall: Pick<Outfall, 'id' | 'status'>): string | null {
  if (outfall.status === 'removed') return null
  return `/environmental/compliance/checklists?${new URLSearchParams({ subject_type: 'outfall', subject: outfall.id })}`
}

// ── the form ────────────────────────────────────────────────────────────────

export interface OutfallFormState {
  code:                     string
  name:                     string
  receivingWater:           string
  drainageArea:             string
  latitude:                 string
  longitude:                string
  outfallType:              OutfallType
  status:                   OutfallStatus
  isSamplingPoint:          boolean
  /** The id of the outfall this one is substantially identical to, or ''. */
  substantiallyIdenticalTo: string
  /** The id of the permit that covers this outfall, or ''. */
  permitId:                 string
  photoPath:                string | null
  notes:                    string
}

export function blankOutfallForm(): OutfallFormState {
  return {
    code: '', name: '', receivingWater: '', drainageArea: '', latitude: '', longitude: '',
    outfallType: 'stormwater', status: 'active', isSamplingPoint: false,
    substantiallyIdenticalTo: '', permitId: '', photoPath: null, notes: '',
  }
}

export function outfallToForm(outfall: Outfall): OutfallFormState {
  return {
    code:                     outfall.code,
    name:                     outfall.name ?? '',
    receivingWater:           outfall.receiving_water ?? '',
    drainageArea:             outfall.drainage_area ?? '',
    latitude:                 outfall.latitude === null ? '' : String(outfall.latitude),
    longitude:                outfall.longitude === null ? '' : String(outfall.longitude),
    outfallType:              outfall.outfall_type,
    status:                   outfall.status,
    isSamplingPoint:          outfall.is_sampling_point,
    substantiallyIdenticalTo: outfall.substantially_identical_to ?? '',
    permitId:                 outfall.permit_id ?? '',
    photoPath:                outfall.photo_path,
    notes:                    outfall.notes ?? '',
  }
}

/** A location is a point only with both numbers; one alone is a mistake to point out, not to guess at. */
export function coordinatePairProblem(latitude: string, longitude: string): string | null {
  return isBlank(latitude) === isBlank(longitude) ? null : 'Latitude and longitude go together: give both or neither.'
}

// A type alias, not an interface: the API client takes a Record<string, unknown>.
export type OutfallRequestBody = {
  code:                       string
  name:                       string | null
  receiving_water:            string | null
  drainage_area:              string | null
  latitude:                   number | null
  longitude:                  number | null
  outfall_type:               OutfallType
  status:                     OutfallStatus
  is_sampling_point:          boolean
  substantially_identical_to: string | null
  permit_id:                  string | null
  photo_path:                 string | null
  notes:                      string | null
}

export type OutfallRequest =
  | { ok: true; body: OutfallRequestBody }
  | { ok: false; errors: string[] }

// Ranges are the API's to judge; here a coordinate only has to be a number,
// because anything else cannot be sent as one.
const isNumberOrBlank = (text: string): boolean => isBlank(text) || Number.isFinite(Number(text.trim()))
const parseCoordinate = (text: string): number | null => (isBlank(text) ? null : Number(text.trim()))

/** The request for the API from the form, or what to fix first. Text is trimmed; blank text is sent as null. */
export function buildOutfallRequest(form: OutfallFormState): OutfallRequest {
  const errors = [
    coordinatePairProblem(form.latitude, form.longitude),
    isNumberOrBlank(form.latitude) ? null : 'Latitude must be a number.',
    isNumberOrBlank(form.longitude) ? null : 'Longitude must be a number.',
  ].filter((problem): problem is string => problem !== null)
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    body: {
      code:                       form.code.trim(),
      name:                       orNull(form.name),
      receiving_water:            orNull(form.receivingWater),
      drainage_area:              orNull(form.drainageArea),
      latitude:                   parseCoordinate(form.latitude),
      longitude:                  parseCoordinate(form.longitude),
      outfall_type:               form.outfallType,
      status:                     form.status,
      is_sampling_point:          form.isSamplingPoint,
      substantially_identical_to: form.substantiallyIdenticalTo || null,
      permit_id:                  form.permitId || null,
      photo_path:                 form.photoPath,
      notes:                      orNull(form.notes),
    },
  }
}
