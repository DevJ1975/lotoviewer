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
