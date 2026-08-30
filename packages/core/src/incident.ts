// Incident Reporting & Investigation — types + small pure helpers shared
// across web and mobile. Mirrors packages/core/src/nearMiss.ts in spirit.
//
// Authoritative shapes live in the DB (migrations 059–066); the types
// here are the read-side contract used by API routes and UI code.
// If the DB schema changes, update this file in the same commit so
// readers stay honest.

// ──────────────────────────────────────────────────────────────────────────
// Enums (text-CHECK columns in migration 059)
// ──────────────────────────────────────────────────────────────────────────

export const INCIDENT_TYPES = [
  'injury_illness', 'near_miss', 'property_damage', 'environmental',
] as const
export type IncidentType = typeof INCIDENT_TYPES[number]

export const INCIDENT_SEVERITY_ACTUAL = [
  'none', 'first_aid', 'medical', 'lost_time', 'fatality', 'catastrophic',
] as const
export type IncidentSeverityActual = typeof INCIDENT_SEVERITY_ACTUAL[number]

export const INCIDENT_SEVERITY_POTENTIAL = [
  'low', 'moderate', 'high', 'extreme',
] as const
export type IncidentSeverityPotential = typeof INCIDENT_SEVERITY_POTENTIAL[number]

export const INCIDENT_PROBABILITY = [
  'rare', 'unlikely', 'possible', 'likely', 'almost_certain',
] as const
export type IncidentProbability = typeof INCIDENT_PROBABILITY[number]

export const INCIDENT_STATUSES = [
  'reported', 'triaged', 'investigating', 'pending_review', 'closed', 'reopened',
] as const
export type IncidentStatus = typeof INCIDENT_STATUSES[number]

export const INCIDENT_SHIFTS = ['day', 'swing', 'night'] as const
export type IncidentShift = typeof INCIDENT_SHIFTS[number]

export const INCIDENT_PERSON_ROLES = [
  'injured', 'witness', 'involved', 'first_responder', 'supervisor', 'reporter',
] as const
export type IncidentPersonRole = typeof INCIDENT_PERSON_ROLES[number]

export const INCIDENT_EMPLOYMENT_TYPES = [
  'employee', 'contractor', 'visitor', 'public', 'volunteer',
] as const
export type IncidentEmploymentType = typeof INCIDENT_EMPLOYMENT_TYPES[number]

export const INCIDENT_SPILL_UNITS = ['gal', 'lb', 'kg', 'L', 'm3'] as const
export type IncidentSpillUnit = typeof INCIDENT_SPILL_UNITS[number]

// ──────────────────────────────────────────────────────────────────────────
// Row shape — incidents
// ──────────────────────────────────────────────────────────────────────────

export interface IncidentRow {
  id:                                string
  tenant_id:                         string
  report_number:                     string                        // INC-YYYY-NNNN, set by trigger
  incident_type:                     IncidentType
  occurred_at:                       string                        // ISO timestamp
  reported_at:                       string
  reported_by:                       string                        // auth user id
  is_anonymous:                      boolean
  location_text:                     string | null
  // Postgres `point` wire format: "(lon,lat)". Never hand-parse it —
  // parseIncidentGeo / formatIncidentGeo below are the only codec.
  location_geo:                      string | null
  shift:                             IncidentShift | null
  description:                       string
  immediate_action_taken:            string | null
  severity_actual:                   IncidentSeverityActual
  severity_potential:                IncidentSeverityPotential | null
  probability:                       IncidentProbability | null
  classification_matrix_cell:        string | null
  status:                            IncidentStatus
  assigned_investigator:             string | null
  related_loto_permit_id:            string | null
  related_hot_work_permit_id:        string | null
  related_confined_space_permit_id:  string | null
  related_jha_id:                    string | null
  workers_comp_claim_number:         string | null
  spill_substance:                   string | null
  spill_quantity:                    number | null
  spill_quantity_unit:               IncidentSpillUnit | null
  legacy_near_miss_id:               string | null
  closed_at:                         string | null
  closed_by:                         string | null
  created_at:                        string
  updated_at:                        string
  updated_by:                        string | null
}

// Shape used by the create wizard / POST /api/incidents. The DB sets
// report_number, reported_at, status (default 'reported'), created/updated,
// and ids — callers just provide the human-supplied fields. tenant_id
// comes from the active-tenant gate; reported_by from the JWT.
export interface IncidentCreateInput {
  incident_type:           IncidentType
  occurred_at:             string
  description:             string
  location_text?:          string | null
  shift?:                  IncidentShift | null
  immediate_action_taken?: string | null
  severity_actual?:        IncidentSeverityActual
  severity_potential?:     IncidentSeverityPotential | null
  probability?:            IncidentProbability | null

  // Type-specific fields. Validators in this file don't require
  // these — the create wizard surfaces them per type.
  spill_substance?:        string | null
  spill_quantity?:         number | null
  spill_quantity_unit?:    IncidentSpillUnit | null

  related_loto_permit_id?:           string | null
  related_hot_work_permit_id?:       string | null
  related_confined_space_permit_id?: string | null
  related_jha_id?:                   string | null

  // GPS captured at intake. Postgres `point` string built by
  // formatIncidentGeo() from the navigator.geolocation result.
  location_geo?:           string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Row shape — incident_people
// ──────────────────────────────────────────────────────────────────────────

export interface IncidentPersonRow {
  id:               string
  tenant_id:        string
  incident_id:      string
  person_role:      IncidentPersonRole
  user_id:          string | null
  full_name:        string | null
  email:            string | null
  phone:            string | null
  employment_type:  IncidentEmploymentType | null
  job_title:        string | null
  hire_date:        string | null
  // PII — present only when the caller passes can_view_incident_pii().
  // The incident_people_safe view returns null otherwise.
  date_of_birth:    string | null
  gender:           string | null
  home_address:     string | null
  body_part:        string[] | null
  injury_nature:    string | null
  injury_source:    string | null
  treatment_facility: string | null
  is_primary:       boolean
  created_at:       string
  updated_at:       string
}

export interface IncidentPersonCreateInput {
  person_role:        IncidentPersonRole
  full_name?:         string | null
  email?:             string | null
  phone?:             string | null
  user_id?:           string | null
  employment_type?:   IncidentEmploymentType | null
  job_title?:         string | null
  hire_date?:         string | null
  date_of_birth?:     string | null
  gender?:            string | null
  home_address?:      string | null
  body_part?:         string[] | null
  injury_nature?:     string | null
  injury_source?:     string | null
  treatment_facility?: string | null
  is_primary?:        boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const SEVERITY_ACTUAL_RANK: Record<IncidentSeverityActual, number> = {
  catastrophic: 0, fatality: 1, lost_time: 2, medical: 3, first_aid: 4, none: 5,
}

const SEVERITY_POTENTIAL_RANK: Record<IncidentSeverityPotential, number> = {
  extreme: 0, high: 1, moderate: 2, low: 3,
}

// Triage sort: most-severe-first (actual, then potential as tiebreaker
// for near-misses where actual is always 'none'), then oldest-first.
export function compareForTriage(a: IncidentRow, b: IncidentRow): number {
  const sa = SEVERITY_ACTUAL_RANK[a.severity_actual] - SEVERITY_ACTUAL_RANK[b.severity_actual]
  if (sa !== 0) return sa
  const apot = a.severity_potential ? SEVERITY_POTENTIAL_RANK[a.severity_potential] : 99
  const bpot = b.severity_potential ? SEVERITY_POTENTIAL_RANK[b.severity_potential] : 99
  if (apot !== bpot) return apot - bpot
  return a.reported_at.localeCompare(b.reported_at)
}

export const ACTIVE_INCIDENT_STATUSES: ReadonlyArray<IncidentStatus> = [
  'reported', 'triaged', 'investigating', 'pending_review', 'reopened',
]

export function isActive(row: Pick<IncidentRow, 'status'>): boolean {
  return ACTIVE_INCIDENT_STATUSES.includes(row.status)
}

// Days between reported_at and now (or closed_at). Floor-rounded;
// never negative.
export function ageInDays(
  row: Pick<IncidentRow, 'reported_at' | 'closed_at'>,
  now: Date = new Date(),
): number {
  const start = new Date(row.reported_at).getTime()
  const end   = row.closed_at ? new Date(row.closed_at).getTime() : now.getTime()
  // A row with an unparseable timestamp would otherwise return NaN,
  // which silently poisons every downstream sum and comparison.
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.floor(Math.max(0, end - start) / 86_400_000)
}

// Human-friendly labels for each enum. Used by drop-downs + chips.
export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  injury_illness:   'Injury / illness',
  near_miss:        'Near miss',
  property_damage:  'Property damage',
  environmental:    'Environmental spill',
}

export const SEVERITY_ACTUAL_LABEL: Record<IncidentSeverityActual, string> = {
  none:         'No injury',
  first_aid:    'First aid only',
  medical:      'Medical treatment',
  lost_time:    'Lost time',
  fatality:     'Fatality',
  catastrophic: 'Catastrophic',
}

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  reported:        'Reported',
  triaged:         'Triaged',
  investigating:   'Investigating',
  pending_review:  'Pending review',
  closed:          'Closed',
  reopened:        'Reopened',
}

// ──────────────────────────────────────────────────────────────────────────
// GPS codec — incidents.location_geo
// ──────────────────────────────────────────────────────────────────────────
//
// The column is a Postgres `point`, whose wire format is "(x,y)". We
// store x = longitude, y = latitude (migration 059: "Stored as
// point(lon, lat)"), which is the GIS axis order every producer here
// already writes. Parsing lived in three places with two different
// axis orders; this is now the only codec, so a reader can never
// disagree with a writer about which number is which.

export interface IncidentGeoPoint {
  lat: number
  lng: number
}

const MAX_LAT = 90
const MAX_LNG = 180
// Six decimals ≈ 0.11 m — well past the accuracy of a phone GPS fix,
// and short enough to keep the stored literal readable.
const GEO_PRECISION = 6

const PG_POINT_RE = /^\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)\s*$/

export function formatIncidentGeo(point: IncidentGeoPoint): string {
  const lng = point.lng.toFixed(GEO_PRECISION)
  const lat = point.lat.toFixed(GEO_PRECISION)
  return `(${lng},${lat})`
}

// Returns null for anything that is not a well-formed, in-range point
// literal — callers treat null as "no GPS", never as "0,0".
export function parseIncidentGeo(raw: unknown): IncidentGeoPoint | null {
  if (typeof raw !== 'string') return null
  const m = PG_POINT_RE.exec(raw)
  if (!m) return null
  const lng = Number(m[1])
  const lat = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > MAX_LAT || Math.abs(lng) > MAX_LNG) return null
  return { lat, lng }
}

// ──────────────────────────────────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────────────────────────────────
//
// DB CHECK constraints are the authority — these are early feedback
// for the wizard. Returns null if valid, error string otherwise.

// Narrow an untrusted JSON body to the create-input shape. Every
// field that isn't the expected primitive becomes undefined/null so
// validateCreateInput() can reject it with a 400 — without this,
// `description: 42` reaches `.trim()` and throws a 500 the reporter
// can't act on. Both intake routes (authenticated and anonymous QR)
// share this so a payload accepted on one path behaves identically
// on the other.
export function coerceCreateInput(body: unknown): Partial<IncidentCreateInput> {
  const b = (body ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)

  return {
    incident_type:           str(b.incident_type) as IncidentType | undefined,
    occurred_at:             str(b.occurred_at),
    description:             str(b.description),
    location_text:           nullableStr(b.location_text),
    shift:                   nullableStr(b.shift) as IncidentShift | null,
    immediate_action_taken:  nullableStr(b.immediate_action_taken),
    severity_actual:         str(b.severity_actual) as IncidentSeverityActual | undefined,
    severity_potential:      nullableStr(b.severity_potential) as IncidentSeverityPotential | null,
    probability:             nullableStr(b.probability) as IncidentProbability | null,
    spill_substance:         nullableStr(b.spill_substance),
    spill_quantity:          typeof b.spill_quantity === 'number' ? b.spill_quantity : null,
    spill_quantity_unit:     nullableStr(b.spill_quantity_unit) as IncidentSpillUnit | null,
    location_geo:            nullableStr(b.location_geo),
    related_loto_permit_id:           nullableStr(b.related_loto_permit_id),
    related_hot_work_permit_id:       nullableStr(b.related_hot_work_permit_id),
    related_confined_space_permit_id: nullableStr(b.related_confined_space_permit_id),
    related_jha_id:                   nullableStr(b.related_jha_id),
  }
}

export function validateCreateInput(input: Partial<IncidentCreateInput>): string | null {
  if (!input.incident_type) return 'Incident type is required'
  if (!(INCIDENT_TYPES as readonly string[]).includes(input.incident_type))
    return `Invalid incident type: ${input.incident_type}`

  if (!input.description || !input.description.trim()) return 'Description is required'
  if (!input.occurred_at) return 'When did it occur? is required'

  const occ = Date.parse(input.occurred_at)
  if (Number.isNaN(occ)) return 'occurred_at is not a valid timestamp'
  // 5-minute clock-skew tolerance.
  if (occ > Date.now() + 5 * 60_000) return 'occurred_at cannot be in the future'

  if (input.severity_actual
      && !(INCIDENT_SEVERITY_ACTUAL as readonly string[]).includes(input.severity_actual))
    return `Invalid severity_actual: ${input.severity_actual}`

  if (input.severity_potential
      && !(INCIDENT_SEVERITY_POTENTIAL as readonly string[]).includes(input.severity_potential))
    return `Invalid severity_potential: ${input.severity_potential}`

  if (input.probability
      && !(INCIDENT_PROBABILITY as readonly string[]).includes(input.probability))
    return `Invalid probability: ${input.probability}`

  if (input.shift && !(INCIDENT_SHIFTS as readonly string[]).includes(input.shift))
    return `Invalid shift: ${input.shift}`

  // Type-specific: environmental spills should have substance + quantity
  // — we don't hard-require it (a witness reporting a spill they saw
  // from a distance may not know quantities) but we do validate units
  // when set.
  if (input.spill_quantity_unit
      && !(INCIDENT_SPILL_UNITS as readonly string[]).includes(input.spill_quantity_unit))
    return `Invalid spill_quantity_unit: ${input.spill_quantity_unit}`

  if (input.spill_quantity != null && (typeof input.spill_quantity !== 'number'
      || !Number.isFinite(input.spill_quantity) || input.spill_quantity < 0))
    return 'spill_quantity must be a non-negative number'

  // Reject a malformed point here rather than letting Postgres reject
  // the INSERT — a `point` parse error surfaces as a 500 the reporter
  // can do nothing about.
  if (input.location_geo != null && parseIncidentGeo(input.location_geo) === null)
    return 'location_geo must be a "(lon,lat)" point within valid GPS bounds'

  // For injuries/illnesses, a near-miss-style severity_potential is
  // allowed but not required; severity_actual carries the OSHA-relevant
  // signal. For near-miss type, severity_actual must be 'none' — anything
  // else is by definition not a near miss.
  if (input.incident_type === 'near_miss'
      && input.severity_actual && input.severity_actual !== 'none')
    return 'A near-miss must have severity_actual="none" — escalate to injury_illness if anyone was hurt'

  return null
}
