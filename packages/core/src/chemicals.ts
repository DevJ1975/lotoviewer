// Cross-platform types + constants for the Chemical Management module.
// Mirrors the shape of migration 082_chemicals_module.sql so the web
// app and a future mobile shell stay aligned.

export const GHS_PICTOGRAMS = [
  'GHS01', // Explosive
  'GHS02', // Flammable
  'GHS03', // Oxidizing
  'GHS04', // Compressed gas
  'GHS05', // Corrosive
  'GHS06', // Acute toxicity (skull & crossbones)
  'GHS07', // Harmful / irritant (exclamation)
  'GHS08', // Health hazard (silhouette)
  'GHS09', // Environmental hazard
] as const
export type GhsPictogram = typeof GHS_PICTOGRAMS[number]

export const GHS_PICTOGRAM_LABEL: Record<GhsPictogram, string> = {
  GHS01: 'Explosive',
  GHS02: 'Flammable',
  GHS03: 'Oxidizing',
  GHS04: 'Compressed gas',
  GHS05: 'Corrosive',
  GHS06: 'Acute toxicity',
  GHS07: 'Irritant / harmful',
  GHS08: 'Health hazard',
  GHS09: 'Environmental hazard',
}

export const GHS_SIGNAL_WORDS = ['danger', 'warning'] as const
export type GhsSignalWord = typeof GHS_SIGNAL_WORDS[number]

export const PHYSICAL_STATES = [
  'solid', 'liquid', 'gas', 'aerosol', 'mixture', 'other',
] as const
export type PhysicalState = typeof PHYSICAL_STATES[number]

export const SDS_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type SdsReviewStatus = typeof SDS_REVIEW_STATUSES[number]

export const SDS_SOURCES = ['upload', 'ai_fetch', 'manufacturer_portal'] as const
export type SdsSource = typeof SDS_SOURCES[number]

export interface HazardStatement { code: string; text: string }
export interface PrecautionaryStatement { code: string; text: string }

export interface ChemicalProductInput {
  name:          string
  manufacturer?: string | null
  product_code?: string | null
  cas_numbers?:  string[]
  synonyms?:     string[]
  physical_state?: PhysicalState | null
  ghs_pictograms?: GhsPictogram[]
  ghs_signal_word?: GhsSignalWord | null
  hazard_statements?: HazardStatement[] | null
  precautionary_statements?: PrecautionaryStatement[] | null
  nfpa_health?:        number | null
  nfpa_flammability?:  number | null
  nfpa_instability?:   number | null
  nfpa_special?:       string | null
  ppe_required?:       string[]
  flash_point_c?:      number | null
  boiling_point_c?:    number | null
  storage_class?:      string | null
  incompatibilities?:  string[]
  sds_revision_date?:  string | null
  sds_source_url?:     string | null
  notes?:              string | null
}

// CAS Registry Number — three groups of digits separated by dashes:
//   2..7 digits / 2 digits / 1 digit, last digit is a checksum.
// We check the format only; checksum verification is a nice-to-have
// but not required to store the value.
const CAS_RE = /^\d{2,7}-\d{2}-\d$/

export function isValidCas(value: string): boolean {
  return CAS_RE.test(value.trim())
}

export interface ProductInputErrors {
  field:   keyof ChemicalProductInput | 'cas_numbers' | 'ghs_pictograms'
  message: string
}

export function validateProductInput(input: ChemicalProductInput): ProductInputErrors[] {
  const errors: ProductInputErrors[] = []

  if (!input.name || !input.name.trim()) {
    errors.push({ field: 'name', message: 'Required' })
  } else if (input.name.length > 200) {
    errors.push({ field: 'name', message: 'Max 200 characters' })
  }

  for (const cas of input.cas_numbers ?? []) {
    if (!isValidCas(cas)) {
      errors.push({ field: 'cas_numbers', message: `Invalid CAS number: ${cas}` })
    }
  }

  for (const p of input.ghs_pictograms ?? []) {
    if (!(GHS_PICTOGRAMS as readonly string[]).includes(p)) {
      errors.push({ field: 'ghs_pictograms', message: `Unknown GHS pictogram: ${p}` })
    }
  }

  const nfpaFields = ['nfpa_health', 'nfpa_flammability', 'nfpa_instability'] as const
  for (const f of nfpaFields) {
    const v = input[f]
    if (v !== null && v !== undefined && (v < 0 || v > 4 || !Number.isInteger(v))) {
      errors.push({ field: f, message: 'Must be 0..4' })
    }
  }

  if (input.ghs_signal_word
      && !(GHS_SIGNAL_WORDS as readonly string[]).includes(input.ghs_signal_word)) {
    errors.push({ field: 'ghs_signal_word', message: 'Must be "danger" or "warning"' })
  }

  return errors
}

// ─── Parsed SDS payload ──────────────────────────────────────────────
//
// The shape Claude returns from /api/chemicals/products/[id]/sds/[id]/parse,
// stored verbatim on chemical_sds_documents.parsed_payload. Keep this
// in lockstep with the JSON schema in app/api/chemicals/.../parse/route.ts.
//
// Confidence is per-field-group, not per-individual-field, because the
// model self-rates a section ("hazards") more reliably than a leaf
// ("nfpa_health"). Apply logic: any group below 'medium' lands in the
// review queue; 'high' across the board can be auto-applied if the
// tenant opts in.

export type ParseConfidence = 'high' | 'medium' | 'low'

export interface ParsedSdsHazardStatement { code: string; text: string }
export interface ParsedSdsPrecautionaryStatement { code: string; text: string }

export interface ParsedSdsFirstAid {
  inhalation?: string | null
  skin?:       string | null
  eyes?:       string | null
  ingestion?:  string | null
  notes?:      string | null
}

export interface ParsedSdsFirefighting {
  suitable_extinguishers?:   string[]
  unsuitable_extinguishers?: string[]
  special_hazards?:          string | null
  protective_equipment?:     string | null
}

export interface ParsedSdsSpillCleanup {
  personal_precautions?:    string | null
  environmental_precautions?: string | null
  containment_methods?:     string | null
  cleanup_methods?:         string | null
}

export interface ParsedSdsPayload {
  // Section 1 — Identification
  product_name:    string
  manufacturer:    string | null
  product_code:    string | null
  recommended_use: string | null
  emergency_phone: string | null

  // Section 3 — Composition / CAS
  cas_numbers: string[]
  synonyms:    string[]

  // Section 9 — Physical / chemical
  physical_state:     PhysicalState | null
  appearance:         string | null
  flash_point_c:      number | null
  boiling_point_c:    number | null
  vapor_pressure_kpa: number | null

  // Section 2 — Hazard ID
  ghs_signal_word:           GhsSignalWord | null
  ghs_pictograms:            GhsPictogram[]
  hazard_statements:         ParsedSdsHazardStatement[]
  precautionary_statements:  ParsedSdsPrecautionaryStatement[]

  // NFPA / HMIS
  nfpa_health:        number | null
  nfpa_flammability:  number | null
  nfpa_instability:   number | null
  nfpa_special:       string | null

  // Section 8 — Exposure controls
  pel_twa_ppm:  number | null
  stel_ppm:     number | null
  idlh_ppm:     number | null
  ppe_required: string[]

  // Section 4 — First aid
  first_aid: ParsedSdsFirstAid

  // Section 5 — Firefighting
  firefighting: ParsedSdsFirefighting

  // Section 6 — Accidental release
  spill_cleanup: ParsedSdsSpillCleanup

  // Section 7 — Storage
  storage_class:     string | null
  incompatibilities: string[]

  // Section 14 — Transport (DOT)
  dot_un_number:     string | null
  dot_hazard_class:  string | null
  dot_packing_group: string | null

  // SDS metadata
  sds_revision_date: string | null   // ISO yyyy-mm-dd, null if not stated
  sds_language:      string | null   // ISO 639-1, e.g. 'en'

  // Self-rated confidence per section group + an overall summary.
  confidence: {
    overall:        ParseConfidence
    identification: ParseConfidence
    hazards:        ParseConfidence
    physical:       ParseConfidence
    exposure:       ParseConfidence
    first_aid:      ParseConfidence
    firefighting:   ParseConfidence
    spill_cleanup:  ParseConfidence
    transport:      ParseConfidence
  }

  // Free-form notes from the model — flagged ambiguities, missing
  // sections, conflicting CAS values, etc. Surfaced in the review UI.
  parser_notes: string | null
}

// Map a ParsedSdsPayload onto the columns we store on chemical_products.
// Used both by the apply endpoint and by the review UI to preview the
// diff without round-tripping the server.
export interface ProductFieldsFromParse {
  name?:                     string
  manufacturer?:             string | null
  product_code?:             string | null
  cas_numbers?:              string[]
  synonyms?:                 string[]
  physical_state?:           PhysicalState | null
  ghs_pictograms?:           GhsPictogram[]
  ghs_signal_word?:          GhsSignalWord | null
  hazard_statements?:        ParsedSdsHazardStatement[]
  precautionary_statements?: ParsedSdsPrecautionaryStatement[]
  nfpa_health?:              number | null
  nfpa_flammability?:        number | null
  nfpa_instability?:         number | null
  nfpa_special?:             string | null
  ppe_required?:             string[]
  flash_point_c?:            number | null
  boiling_point_c?:          number | null
  vapor_pressure_kpa?:       number | null
  pel_twa_ppm?:              number | null
  stel_ppm?:                 number | null
  idlh_ppm?:                 number | null
  first_aid?:                ParsedSdsFirstAid
  firefighting?:             ParsedSdsFirefighting
  spill_cleanup?:            ParsedSdsSpillCleanup
  storage_class?:            string | null
  incompatibilities?:        string[]
  dot_un_number?:            string | null
  dot_hazard_class?:         string | null
  dot_packing_group?:        string | null
  sds_revision_date?:        string | null
}

// Decide whether a parsed SDS is confident enough to apply to a product
// without manual review. Conservative: any group below 'high' on a
// regulatory-critical section requires human eyes.
export function canAutoApplyParse(parsed: ParsedSdsPayload): boolean {
  const c = parsed.confidence
  return (
    c.overall      === 'high' &&
    c.identification === 'high' &&
    c.hazards      === 'high' &&
    c.exposure     === 'high'
  )
}

export function parseToProductFields(parsed: ParsedSdsPayload): ProductFieldsFromParse {
  // Strip empty arrays / blank strings so we don't overwrite existing
  // values with junk. The apply endpoint can then merge field-by-field
  // and respect the "preserve manual edits" UX.
  const out: ProductFieldsFromParse = {}
  if (parsed.product_name && parsed.product_name.trim()) out.name = parsed.product_name.trim()
  if (parsed.manufacturer)    out.manufacturer    = parsed.manufacturer
  if (parsed.product_code)    out.product_code    = parsed.product_code
  if (parsed.cas_numbers && parsed.cas_numbers.length > 0)
    out.cas_numbers = parsed.cas_numbers.filter(c => isValidCas(c))
  if (parsed.synonyms && parsed.synonyms.length > 0) out.synonyms = parsed.synonyms

  if (parsed.physical_state)  out.physical_state  = parsed.physical_state
  if (parsed.ghs_pictograms && parsed.ghs_pictograms.length > 0) out.ghs_pictograms = parsed.ghs_pictograms
  if (parsed.ghs_signal_word) out.ghs_signal_word = parsed.ghs_signal_word
  if (parsed.hazard_statements && parsed.hazard_statements.length > 0)
    out.hazard_statements = parsed.hazard_statements
  if (parsed.precautionary_statements && parsed.precautionary_statements.length > 0)
    out.precautionary_statements = parsed.precautionary_statements

  if (parsed.nfpa_health        !== null) out.nfpa_health        = parsed.nfpa_health
  if (parsed.nfpa_flammability  !== null) out.nfpa_flammability  = parsed.nfpa_flammability
  if (parsed.nfpa_instability   !== null) out.nfpa_instability   = parsed.nfpa_instability
  if (parsed.nfpa_special)                out.nfpa_special       = parsed.nfpa_special

  if (parsed.ppe_required && parsed.ppe_required.length > 0) out.ppe_required = parsed.ppe_required

  if (parsed.flash_point_c      !== null) out.flash_point_c      = parsed.flash_point_c
  if (parsed.boiling_point_c    !== null) out.boiling_point_c    = parsed.boiling_point_c
  if (parsed.vapor_pressure_kpa !== null) out.vapor_pressure_kpa = parsed.vapor_pressure_kpa
  if (parsed.pel_twa_ppm        !== null) out.pel_twa_ppm        = parsed.pel_twa_ppm
  if (parsed.stel_ppm           !== null) out.stel_ppm           = parsed.stel_ppm
  if (parsed.idlh_ppm           !== null) out.idlh_ppm           = parsed.idlh_ppm

  if (hasAnyValue(parsed.first_aid))    out.first_aid    = parsed.first_aid
  if (hasAnyValue(parsed.firefighting)) out.firefighting = parsed.firefighting
  if (hasAnyValue(parsed.spill_cleanup)) out.spill_cleanup = parsed.spill_cleanup

  if (parsed.storage_class) out.storage_class = parsed.storage_class
  if (parsed.incompatibilities && parsed.incompatibilities.length > 0)
    out.incompatibilities = parsed.incompatibilities

  if (parsed.dot_un_number)     out.dot_un_number     = parsed.dot_un_number
  if (parsed.dot_hazard_class)  out.dot_hazard_class  = parsed.dot_hazard_class
  if (parsed.dot_packing_group) out.dot_packing_group = parsed.dot_packing_group

  if (parsed.sds_revision_date) out.sds_revision_date = parsed.sds_revision_date

  return out
}

function hasAnyValue(obj: object | null | undefined): boolean {
  if (!obj) return false
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    return true
  }
  return false
}

// ─── Inventory items (Phase D) ───────────────────────────────────────────

export const INVENTORY_STATUSES = [
  'requested', 'in_stock', 'in_use', 'empty',
  'quarantined', 'disposed', 'rejected',
] as const
export type InventoryStatus = typeof INVENTORY_STATUSES[number]

export const INVENTORY_STATUS_LABEL: Record<InventoryStatus, string> = {
  requested:   'Requested',
  in_stock:    'In stock',
  in_use:      'In use',
  empty:       'Empty',
  quarantined: 'Quarantined',
  disposed:    'Disposed',
  rejected:    'Rejected',
}

/** Statuses that count as "live" — visible by default in the catalog
 * and on the chemical detail page. Disposed/empty/rejected containers
 * are historical and only surface via filters. */
export const ACTIVE_INVENTORY_STATUSES: readonly InventoryStatus[] =
  ['requested', 'in_stock', 'in_use', 'quarantined'] as const

/**
 * Decide whether a status transition is legal. The approval workflow
 * disallows skipping straight from 'requested' to states that imply
 * physical use (`in_use`, `empty`, `quarantined`, `disposed`); the
 * worker has to be approved to in_stock first. 'rejected' is a
 * dead-end terminal state.
 */
export function isLegalStatusTransition(
  from: InventoryStatus,
  to:   InventoryStatus,
): boolean {
  if (from === to) return true

  if (from === 'rejected') return false  // terminal
  if (from === 'disposed') return false  // terminal

  if (from === 'requested') {
    // Approve → in_stock; reject → rejected; or cancel back to disposed.
    return to === 'in_stock' || to === 'rejected' || to === 'disposed'
  }
  // Once approved, the live-state machine is permissive.
  if (to === 'rejected') return false   // can't retroactively reject post-approval
  return true
}

export const INVENTORY_UNITS = [
  'gal', 'L', 'mL', 'kg', 'g', 'lb', 'oz', 'ea', 'other',
] as const
export type InventoryUnit = typeof INVENTORY_UNITS[number]

export const CONTAINER_TYPES = [
  'drum', 'tote', 'pail', 'bottle', 'aerosol', 'cylinder',
  'bag', 'box', 'jerrican', 'tank', 'other',
] as const
export type ContainerType = typeof CONTAINER_TYPES[number]

export const LOCATION_KINDS = [
  'site', 'building', 'room', 'cabinet', 'shelf', 'other',
] as const
export type LocationKind = typeof LOCATION_KINDS[number]

export interface InventoryItemInput {
  product_id:       string
  location_id?:     string | null
  department?:      string | null
  /** When omitted, the API allocates one via chemical_next_barcode(). */
  barcode?:         string | null
  quantity:         number
  unit:             InventoryUnit
  container_type?:  ContainerType | null
  received_date?:   string | null    // ISO yyyy-mm-dd
  opened_date?:     string | null
  expiration_date?: string | null
  lot_number?:      string | null
  manufacture_date?: string | null
  status?:          InventoryStatus
  assigned_to?:     string | null
  purchase_order?:  string | null
  cost_cents?:      number | null
  notes?:           string | null
}

export interface InventoryInputErrors {
  field:   keyof InventoryItemInput
  message: string
}

export function validateInventoryInput(input: InventoryItemInput): InventoryInputErrors[] {
  const errs: InventoryInputErrors[] = []
  if (!input.product_id) errs.push({ field: 'product_id', message: 'Required' })
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    errs.push({ field: 'quantity', message: 'Must be a non-negative number' })
  }
  if (!(INVENTORY_UNITS as readonly string[]).includes(input.unit)) {
    errs.push({ field: 'unit', message: 'Unknown unit' })
  }
  if (input.container_type
      && !(CONTAINER_TYPES as readonly string[]).includes(input.container_type)) {
    errs.push({ field: 'container_type', message: 'Unknown container type' })
  }
  if (input.status
      && !(INVENTORY_STATUSES as readonly string[]).includes(input.status)) {
    errs.push({ field: 'status', message: 'Unknown status' })
  }
  for (const f of ['received_date', 'opened_date', 'expiration_date', 'manufacture_date'] as const) {
    const v = input[f]
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      errs.push({ field: f, message: 'Must be yyyy-mm-dd' })
    }
  }
  if (input.cost_cents !== null && input.cost_cents !== undefined
      && (!Number.isInteger(input.cost_cents) || input.cost_cents < 0)) {
    errs.push({ field: 'cost_cents', message: 'Must be a non-negative integer (cents)' })
  }
  return errs
}

/**
 * Days from today until an ISO date. Negative values mean already past.
 * Returns null on missing or malformed dates.
 */
export function daysUntil(isoDate: string | null | undefined, today = new Date()): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const target = Date.parse(isoDate + 'T00:00:00Z')
  if (Number.isNaN(target)) return null
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((target - todayUtc) / 86_400_000)
}

export type ExpiryTier = 'expired' | 'critical' | 'warning' | 'ok' | 'unknown'

/**
 * Bucket a container by its expiration date for dashboard rollups.
 *  - expired   : already past
 *  - critical  : ≤ 7 days
 *  - warning   : ≤ 30 days
 *  - ok        : > 30 days
 *  - unknown   : no expiration date set
 */
export function expiryTier(isoDate: string | null | undefined, today = new Date()): ExpiryTier {
  const d = daysUntil(isoDate, today)
  if (d === null) return 'unknown'
  if (d < 0)  return 'expired'
  if (d <= 7) return 'critical'
  if (d <= 30) return 'warning'
  return 'ok'
}

// ─── Compliance (Phase F) ────────────────────────────────────────────────

export const EXPOSURE_ROUTES = [
  'inhalation', 'skin_absorption', 'eye_contact',
  'ingestion', 'injection', 'unknown',
] as const
export type ExposureRoute = typeof EXPOSURE_ROUTES[number]

export const EXPOSURE_ROUTE_LABEL: Record<ExposureRoute, string> = {
  inhalation:      'Inhalation',
  skin_absorption: 'Skin absorption',
  eye_contact:     'Eye contact',
  ingestion:       'Ingestion',
  injection:       'Injection',
  unknown:         'Unknown',
}

export const EXPOSURE_SEVERITIES = [
  'no_symptoms', 'first_aid', 'medical_treatment', 'lost_time', 'fatality',
] as const
export type ExposureSeverity = typeof EXPOSURE_SEVERITIES[number]

export const EXPOSURE_SEVERITY_LABEL: Record<ExposureSeverity, string> = {
  no_symptoms:       'No symptoms',
  first_aid:         'First aid only',
  medical_treatment: 'Medical treatment',
  lost_time:         'Lost time',
  fatality:          'Fatality',
}

export interface ExposureEventInput {
  incident_id:                string
  product_id:                 string
  inventory_item_id?:         string | null
  person_id?:                 string | null
  route:                      ExposureRoute
  estimated_quantity?:        string | null
  exposure_duration_minutes?: number | null
  severity?:                  ExposureSeverity | null
  ppe_in_use?:                string[]
  measured_ppm?:              number | null
  notes?:                     string | null
}

export interface ExposureInputErrors {
  field:   keyof ExposureEventInput
  message: string
}

export function validateExposureInput(input: ExposureEventInput): ExposureInputErrors[] {
  const errs: ExposureInputErrors[] = []
  if (!input.incident_id) errs.push({ field: 'incident_id', message: 'Required' })
  if (!input.product_id)  errs.push({ field: 'product_id',  message: 'Required' })
  if (!(EXPOSURE_ROUTES as readonly string[]).includes(input.route)) {
    errs.push({ field: 'route', message: 'Unknown exposure route' })
  }
  if (input.severity
      && !(EXPOSURE_SEVERITIES as readonly string[]).includes(input.severity)) {
    errs.push({ field: 'severity', message: 'Unknown severity' })
  }
  if (input.exposure_duration_minutes !== null
      && input.exposure_duration_minutes !== undefined
      && (!Number.isFinite(input.exposure_duration_minutes)
          || input.exposure_duration_minutes < 0)) {
    errs.push({ field: 'exposure_duration_minutes', message: 'Must be a non-negative number' })
  }
  if (input.measured_ppm !== null
      && input.measured_ppm !== undefined
      && (!Number.isFinite(input.measured_ppm) || input.measured_ppm < 0)) {
    errs.push({ field: 'measured_ppm', message: 'Must be a non-negative number' })
  }
  return errs
}

// ─── Tier II export ──────────────────────────────────────────────────────
//
// Tier II is a per-state report, but the columns the EPA + every state
// expects are largely the same. We emit a "universal" CSV that matches
// the EPA's Tier2 Submit fields; tenants who need a state-specific
// format can transform from this column set without losing data.

export interface TierTwoRow {
  product_id:        string
  product_name:      string
  manufacturer:      string | null
  cas_numbers:       string[] | null
  storage_class:     string | null
  physical_state:    string | null
  ghs_signal_word:   string | null
  ghs_pictograms:    string[] | null
  location_id:       string | null
  location_name:     string | null
  location_path:     string | null
  unit:              string
  total_quantity:         number
  max_daily_quantity:     number
  average_daily_quantity: number
  container_count:        number
  earliest_expiration:    string | null
}

const TIER_TWO_COLUMNS = [
  'product_name',
  'manufacturer',
  'cas_numbers',
  'storage_class',
  'physical_state',
  'ghs_signal_word',
  'ghs_pictograms',
  'location_path',
  'unit',
  'total_quantity',
  'max_daily_quantity',
  'average_daily_quantity',
  'container_count',
  'earliest_expiration',
] as const

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = Array.isArray(value) ? value.join('; ') : String(value)
  // RFC 4180: wrap in quotes if it contains a comma, quote, or newline;
  // double internal quotes.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Render a Tier II rollup as a CSV string. RFC 4180 compliant; emits
 * a UTF-8 BOM so Excel opens it correctly.
 */
export function tierTwoToCsv(rows: TierTwoRow[]): string {
  const lines: string[] = []
  // BOM + header
  lines.push('﻿' + TIER_TWO_COLUMNS.map(c => csvEscape(c)).join(','))
  for (const r of rows) {
    const dict = r as unknown as Record<string, unknown>
    lines.push(TIER_TWO_COLUMNS.map(c => csvEscape(dict[c])).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

// ─── Restricted list (Phase G) ──────────────────────────────────────────

export const RESTRICTION_SEVERITIES = ['banned', 'restricted', 'discouraged'] as const
export type RestrictionSeverity = typeof RESTRICTION_SEVERITIES[number]

export interface RestrictionRule {
  id:           string
  cas_number:   string | null
  name_pattern: string | null
  severity:     RestrictionSeverity
  reason:       string | null
  alternative:  string | null
  reference:    string | null
}

/**
 * Find all rules a candidate product hits. Server-side calls usually
 * use the chemical_restricted_match() RPC which does the same thing
 * inside Postgres; this helper exists for client-side previews (the
 * add-chemical form can flag a CAS the user just typed BEFORE submit).
 */
export function matchRestrictions(
  product: { name: string; cas_numbers: readonly string[] },
  rules:   readonly RestrictionRule[],
): RestrictionRule[] {
  const cas = new Set(product.cas_numbers)
  const lowerName = product.name.toLowerCase()
  return rules.filter(r => {
    if (r.cas_number) return cas.has(r.cas_number)
    if (r.name_pattern) {
      // Convert SQL ilike pattern to a regex: % → .*, _ → .
      const escaped = r.name_pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.')
      try {
        return new RegExp(`^${escaped}$`, 'i').test(lowerName)
      } catch {
        return false
      }
    }
    return false
  })
}

/** True if any matched rule has severity 'banned' or 'restricted'. */
export function isBlockedByRestrictions(rules: readonly RestrictionRule[]): boolean {
  return rules.some(r => r.severity === 'banned' || r.severity === 'restricted')
}

/** True if any matched rule is the absolute-no 'banned' tier. */
export function isHardBanned(rules: readonly RestrictionRule[]): boolean {
  return rules.some(r => r.severity === 'banned')
}

// ─── Compatibility checker (Phase G) ────────────────────────────────────
//
// Default rules are intentionally conservative — they trigger on
// well-known industrial pairings that NFPA / EPA Chem-Compatibility
// charts list as "must not store together". Tenants override via
// chemical_incompatibility_overrides; the checker layers them on top.

export interface IncompatibilityFinding {
  /** Sorted pair so the rule UI can render symmetrically. */
  a:        string
  b:        string
  /** 'pictogram' | 'storage_class' */
  kind:     'pictogram' | 'storage_class'
  reason:   string
  /** 'block' (default rule says no) | 'allow' (override permits). */
  posture:  'block' | 'allow'
  /** True when the pair came from the tenant override table. */
  override: boolean
}

interface DefaultRule {
  a:      GhsPictogram | string
  b:      GhsPictogram | string
  kind:   'pictogram' | 'storage_class'
  reason: string
}

const DEFAULT_INCOMPATIBILITY_RULES: DefaultRule[] = [
  // GHS-pictogram pairings — the worst offenders.
  {
    a: 'GHS02', b: 'GHS03', kind: 'pictogram',
    reason: 'Flammable + oxidizer (GHS02 + GHS03) — NFPA 430. Must be stored in separate cabinets / rooms.',
  },
  {
    a: 'GHS01', b: 'GHS02', kind: 'pictogram',
    reason: 'Explosive + flammable (GHS01 + GHS02) — store explosives in dedicated magazine away from ignition sources.',
  },
  {
    a: 'GHS01', b: 'GHS03', kind: 'pictogram',
    reason: 'Explosive + oxidizer (GHS01 + GHS03) — never co-store.',
  },
  {
    a: 'GHS05', b: 'GHS06', kind: 'pictogram',
    reason: 'Corrosive + acutely toxic (GHS05 + GHS06) — segregate to prevent toxic gas from a corrosion event.',
  },
  // Storage-class pairings (informal but widely used in EHS shops).
  {
    a: 'acid', b: 'base', kind: 'storage_class',
    reason: 'Acids and bases react exothermically. Use separate corrosive cabinets segregated by class.',
  },
  {
    a: 'acid', b: 'cyanide', kind: 'storage_class',
    reason: 'Acids + cyanides liberate hydrogen cyanide gas. Never co-store.',
  },
  {
    a: 'flammable_cabinet', b: 'oxidizer_cabinet', kind: 'storage_class',
    reason: 'Flammable + oxidizer cabinets must not share an interior — pair fire risks compounded.',
  },
]

function sortPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

/**
 * Compute the set of incompatibility findings between two products
 * sharing a location, applying tenant overrides on top of defaults.
 *
 * Overrides win: if a tenant has explicitly marked a pair compatible
 * (e.g. "isolated annex"), the default block is suppressed — but a
 * finding with posture='allow' is still returned so the UI can flag
 * "this pair would normally block, you've allowed it because: …".
 */
export interface ProductForCompatibility {
  ghs_pictograms?: readonly string[] | null
  storage_class?:  string | null
}

export interface OverrideRule {
  key_a:      string
  key_b:      string
  key_kind:   'pictogram' | 'storage_class'
  compatible: boolean
  reason:     string | null
}

export function findIncompatibilities(
  a: ProductForCompatibility,
  b: ProductForCompatibility,
  overrides: readonly OverrideRule[] = [],
): IncompatibilityFinding[] {
  const findings: IncompatibilityFinding[] = []

  const overrideMap = new Map<string, OverrideRule>()
  for (const o of overrides) {
    overrideMap.set(`${o.key_kind}|${o.key_a}|${o.key_b}`, o)
  }

  for (const rule of DEFAULT_INCOMPATIBILITY_RULES) {
    const matchPair = (() => {
      if (rule.kind === 'pictogram') {
        const A = (a.ghs_pictograms ?? [])
        const B = (b.ghs_pictograms ?? [])
        return (A.includes(rule.a) && B.includes(rule.b))
            || (A.includes(rule.b) && B.includes(rule.a))
      }
      const aClass = (a.storage_class ?? '').toLowerCase()
      const bClass = (b.storage_class ?? '').toLowerCase()
      return (aClass.includes(rule.a) && bClass.includes(rule.b))
          || (aClass.includes(rule.b) && bClass.includes(rule.a))
    })()
    if (!matchPair) continue
    const [keyA, keyB] = sortPair(rule.a, rule.b)
    const override = overrideMap.get(`${rule.kind}|${keyA}|${keyB}`)
    if (override) {
      findings.push({
        a: keyA, b: keyB, kind: rule.kind,
        reason:   override.reason ?? rule.reason,
        posture:  override.compatible ? 'allow' : 'block',
        override: true,
      })
    } else {
      findings.push({
        a: keyA, b: keyB, kind: rule.kind,
        reason: rule.reason, posture: 'block', override: false,
      })
    }
  }

  // Tenant-only rules: pairs the defaults don't cover but the tenant
  // has marked incompatible.
  for (const o of overrides) {
    if (o.compatible) continue   // 'allow' overrides only relevant if a default existed
    const isDefault = DEFAULT_INCOMPATIBILITY_RULES.some(d =>
      d.kind === o.key_kind
      && (sortPair(d.a, d.b)[0] === o.key_a && sortPair(d.a, d.b)[1] === o.key_b))
    if (isDefault) continue       // already handled above

    const matchPair = (() => {
      if (o.key_kind === 'pictogram') {
        const A = (a.ghs_pictograms ?? [])
        const B = (b.ghs_pictograms ?? [])
        return (A.includes(o.key_a) && B.includes(o.key_b))
            || (A.includes(o.key_b) && B.includes(o.key_a))
      }
      const aClass = (a.storage_class ?? '').toLowerCase()
      const bClass = (b.storage_class ?? '').toLowerCase()
      return (aClass.includes(o.key_a) && bClass.includes(o.key_b))
          || (aClass.includes(o.key_b) && bClass.includes(o.key_a))
    })()
    if (!matchPair) continue
    findings.push({
      a: o.key_a, b: o.key_b, kind: o.key_kind,
      reason:   o.reason ?? 'Tenant-defined incompatibility',
      posture:  'block',
      override: true,
    })
  }

  return findings
}

/** Convenience: any blocking findings between the candidate and ANY
 * existing co-located product. Returns the first conflict per existing
 * product; the UI groups by product. */
export function checkLocationCompatibility(
  candidate: ProductForCompatibility,
  existing:  readonly ({ id: string; name: string } & ProductForCompatibility)[],
  overrides: readonly OverrideRule[] = [],
): { product_id: string; product_name: string; findings: IncompatibilityFinding[] }[] {
  const out: { product_id: string; product_name: string; findings: IncompatibilityFinding[] }[] = []
  for (const e of existing) {
    const findings = findIncompatibilities(candidate, e, overrides)
      .filter(f => f.posture === 'block')
    if (findings.length > 0) {
      out.push({ product_id: e.id, product_name: e.name, findings })
    }
  }
  return out
}

// ─── PPE derivation (Phase G slice 3) ──────────────────────────────────
//
// JHA steps tagged with chemicals derive their required PPE from the
// union of every linked chemical's `ppe_required` field. The editor
// uses ppeGapAnalysis to flag missing items the JHA's listed PPE
// doesn't cover, AND to flag unrelated items the JHA lists that no
// chemical actually calls for (those usually trace to a non-chemical
// hazard like noise or fall-protection — fine, but worth a chip).

/**
 * Normalize a PPE string for comparison: lowercase, collapse
 * whitespace, strip trailing punctuation. "Nitrile gloves",
 * "  nitrile  gloves.", and "NITRILE GLOVES" all collapse to the
 * same key. Returns null for blank input.
 */
export function normalizePpeKey(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')
  return trimmed || null
}

export interface PpeGap {
  /** PPE the chemicals require but the JHA doesn't list. */
  missing:    string[]
  /** PPE the JHA lists that no linked chemical asks for. Could be
   *  legitimate (non-chemical hazards) — surface as info, not error. */
  unmatched:  string[]
  /** PPE present on both — confirms coverage. */
  covered:    string[]
}

/**
 * Compare the union of chemical PPE against a JHA step's currently-
 * listed PPE. Comparison is case-insensitive + whitespace-tolerant.
 * Returns the original-case string from whichever side first declared
 * it so the UI doesn't lowercase a label the author capitalized.
 */
export function ppeGapAnalysis(
  chemicalsPpe: readonly string[],
  listedPpe:    readonly string[],
): PpeGap {
  const chemMap = new Map<string, string>()
  for (const p of chemicalsPpe) {
    const k = normalizePpeKey(p)
    if (k && !chemMap.has(k)) chemMap.set(k, p)
  }
  const listedMap = new Map<string, string>()
  for (const p of listedPpe) {
    const k = normalizePpeKey(p)
    if (k && !listedMap.has(k)) listedMap.set(k, p)
  }

  const missing:   string[] = []
  const unmatched: string[] = []
  const covered:   string[] = []

  for (const [k, original] of chemMap) {
    if (listedMap.has(k)) covered.push(original)
    else missing.push(original)
  }
  for (const [k, original] of listedMap) {
    if (!chemMap.has(k)) unmatched.push(original)
  }

  return {
    missing:   missing.sort((a, b) => a.localeCompare(b)),
    unmatched: unmatched.sort((a, b) => a.localeCompare(b)),
    covered:   covered.sort((a, b) => a.localeCompare(b)),
  }
}

/**
 * Union the `ppe_required` arrays from a list of products into a
 * single deduped (case-insensitive) array, preserving original case
 * of the first occurrence. Used by the JHA step panel to render the
 * "derived PPE" pill row.
 */
export function unionChemicalPpe(
  products: readonly { ppe_required?: readonly string[] | null }[],
): string[] {
  const seen = new Map<string, string>()
  for (const p of products) {
    for (const ppe of p.ppe_required ?? []) {
      const k = normalizePpeKey(ppe)
      if (k && !seen.has(k)) seen.set(k, ppe)
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
}

// ─── Weekly digest backstop (Phase G slice 5) ──────────────────────────
//
// Push notifications cover the real-time path for SDS revisions and
// container approvals. The weekly digest is the "I missed it"
// backstop for tenants without push enabled, and a roll-up review of
// drift activity over the period for tenants that do.

export interface DigestSdsRow {
  product_id:      string
  product_name:    string
  manufacturer:    string | null
  revision_date:   string | null   // baseline → latest formatted by caller
  parsed_at:       string          // SDS document created_at
}

export interface DigestApprovalRow {
  inventory_id:   string
  product_name:   string
  barcode:        string
  requester_name: string | null
  requested_at:   string | null
  age_days:       number           // how long the request has been waiting
}

export interface DigestDriftRow {
  product_id:    string
  product_name:  string
  outcome:       'newer' | 'older' | 'fetch_failed'
  checked_at:    string
  notes:         string | null
}

export interface DigestExpiringRow {
  product_name:    string
  barcode:         string
  location_path:   string | null
  expiration_date: string | null
  days_remaining:  number
}

export interface ChemicalsDigest {
  tenant_id:    string
  tenant_name:  string
  pending_sds:        DigestSdsRow[]        // parse_review_status='pending'
  pending_approvals:  DigestApprovalRow[]   // status='requested'
  drift_events:       DigestDriftRow[]      // last 7 days, non-unchanged
  expiring_soon:      DigestExpiringRow[]   // ≤30 days
}

/** True when the digest has nothing actionable — caller skips the send. */
export function isDigestEmpty(d: ChemicalsDigest): boolean {
  return d.pending_sds.length === 0
      && d.pending_approvals.length === 0
      && d.drift_events.length === 0
      && d.expiring_soon.length === 0
}

/** Subject-line summary, e.g. "Chemicals: 2 SDS pending, 3 expiring".
 *  Empty input returns null so the caller can skip. */
export function digestSubjectSummary(d: ChemicalsDigest): string | null {
  if (isDigestEmpty(d)) return null
  const parts: string[] = []
  if (d.pending_sds.length)       parts.push(`${d.pending_sds.length} SDS pending`)
  if (d.pending_approvals.length) parts.push(`${d.pending_approvals.length} approval${d.pending_approvals.length === 1 ? '' : 's'}`)
  if (d.drift_events.length)      parts.push(`${d.drift_events.length} drift event${d.drift_events.length === 1 ? '' : 's'}`)
  if (d.expiring_soon.length)     parts.push(`${d.expiring_soon.length} expiring`)
  return parts.join(', ')
}

// Storage path layout for the chemical-sds bucket. Tenant-scoped first
// segment so storage_path_tenant() (migration 033) gates writes.
export function chemicalSdsStoragePath(
  tenantId: string,
  productId: string,
  filename: string,
): string {
  // Strip directory traversal + collapse to a safe filename.
  const safe = filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'sds.pdf'
  return `${tenantId}/${productId}/${safe}`
}
