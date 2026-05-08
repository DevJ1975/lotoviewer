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
