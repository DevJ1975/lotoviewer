// Fleet Safety — vehicle, placard, document, and chemical-link domain.
//
// Pure (no DOM / Node) so the cron + tests + a future mobile surface can
// all import it. Mirrors the codebase convention: const-array enums and
// `string | null` validators (no Zod). The web API routes call these
// validators before writing; the DB CHECK constraints in migration 199
// are the final gate.

// ── Enums ────────────────────────────────────────────────────────────────
export const VEHICLE_TYPES = [
  'car', 'pickup', 'van', 'box_truck', 'tractor', 'trailer',
  'bus', 'forklift', 'heavy_equipment', 'other',
] as const
export type VehicleType = typeof VEHICLE_TYPES[number]

export const VEHICLE_STATUSES = ['active', 'out_of_service', 'retired'] as const
export type VehicleStatus = typeof VEHICLE_STATUSES[number]

export const FUEL_TYPES = [
  'diesel', 'gasoline', 'electric', 'propane', 'cng', 'lng', 'hybrid', 'other',
] as const
export type FuelType = typeof FUEL_TYPES[number]

// FHWA gross-vehicle-weight classes 1–8.
export const DOT_VEHICLE_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
export type DotVehicleClass = typeof DOT_VEHICLE_CLASSES[number]

// DOT hazard classes 1–9 (49 CFR 173.2).
export const HAZARD_CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
export type HazardClass = typeof HAZARD_CLASSES[number]

export const DOCUMENT_TYPES = [
  'insurance', 'registration', 'dot_inspection', 'ifta', 'permit', 'title', 'other',
] as const
export type DocumentType = typeof DOCUMENT_TYPES[number]

export const QUANTITY_UNITS = ['gal', 'lb', 'kg', 'L', 'm3', 'each'] as const
export type QuantityUnit = typeof QUANTITY_UNITS[number]

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  car: 'Car', pickup: 'Pickup', van: 'Van', box_truck: 'Box truck',
  tractor: 'Tractor', trailer: 'Trailer', bus: 'Bus', forklift: 'Forklift',
  heavy_equipment: 'Heavy equipment', other: 'Other',
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  insurance: 'Insurance', registration: 'Registration',
  dot_inspection: 'Annual DOT inspection', ifta: 'IFTA',
  permit: 'Permit', title: 'Title', other: 'Other',
}

// Short human label per DOT hazard class — used in placard chips + the
// hazmat summary. Names follow the 49 CFR 172.504 placard table.
export const HAZARD_CLASS_LABELS: Record<HazardClass, string> = {
  '1': 'Explosives', '2': 'Gases', '3': 'Flammable liquids',
  '4': 'Flammable solids', '5': 'Oxidizers / organic peroxides',
  '6': 'Toxic / infectious', '7': 'Radioactive', '8': 'Corrosives',
  '9': 'Miscellaneous',
}

// ── Row + input shapes ─────────────────────────────────────────────────────
export interface VehicleRow {
  id:                       string
  tenant_id:                string
  unit_number:              string | null
  make:                     string | null
  model:                    string | null
  model_year:               number | null
  vin:                      string | null
  license_plate:            string | null
  license_plate_state:      string | null
  vehicle_type:             VehicleType
  status:                   VehicleStatus
  photo_path:               string | null
  odometer_miles:           number | null
  usdot_number:             string | null
  mc_number:                string | null
  gvwr_lbs:                 number | null
  dot_vehicle_class:        DotVehicleClass | null
  annual_dot_inspection_at: string | null
  ifta_registered:          boolean
  fuel_type:                FuelType | null
  carries_hazmat:           boolean
  hazmat_notes:             string | null
  assigned_driver_id:       string | null
  home_location_text:       string | null
  notes:                    string | null
  created_at:               string
  updated_at:               string
}

export interface VehicleInput {
  unit_number?:              string | null
  make?:                     string | null
  model?:                    string | null
  model_year?:               number | null
  vin?:                      string | null
  license_plate?:            string | null
  license_plate_state?:      string | null
  vehicle_type?:             VehicleType
  status?:                   VehicleStatus
  photo_path?:               string | null
  odometer_miles?:           number | null
  usdot_number?:             string | null
  mc_number?:                string | null
  gvwr_lbs?:                 number | null
  dot_vehicle_class?:        DotVehicleClass | null
  annual_dot_inspection_at?: string | null
  ifta_registered?:          boolean
  fuel_type?:                FuelType | null
  carries_hazmat?:           boolean
  hazmat_notes?:             string | null
  assigned_driver_id?:       string | null
  home_location_text?:       string | null
  notes?:                    string | null
}

export interface PlacardRow {
  id:                   string
  tenant_id:            string
  vehicle_id:           string
  hazard_class:         HazardClass
  division:             string | null
  un_number:            string | null
  proper_shipping_name: string | null
  placard_label:        string | null
  notes:                string | null
}

export interface DocumentRow {
  id:         string
  tenant_id:  string
  vehicle_id: string
  doc_type:   DocumentType
  reference:  string | null
  issued_at:  string | null
  expires_at: string | null
  file_path:  string | null
  file_name:  string | null
  mime_type:  string | null
  notes:      string | null
}

// ── Validation ─────────────────────────────────────────────────────────────
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate a vehicle create/patch payload. Returns the first problem as a
 * human message, or null when the input is acceptable. A vehicle needs at
 * least one identifier (unit number, VIN, or plate) so it isn't a ghost row.
 */
export function validateVehicleInput(input: VehicleInput): string | null {
  const hasIdentity =
    nonEmpty(input.unit_number) || nonEmpty(input.vin) || nonEmpty(input.license_plate)
  if (!hasIdentity) {
    return 'A vehicle needs at least a unit number, VIN, or license plate.'
  }
  if (input.vehicle_type !== undefined && !VEHICLE_TYPES.includes(input.vehicle_type)) {
    return `vehicle_type must be one of ${VEHICLE_TYPES.join(', ')}`
  }
  if (input.status !== undefined && !VEHICLE_STATUSES.includes(input.status)) {
    return `status must be one of ${VEHICLE_STATUSES.join(', ')}`
  }
  if (input.fuel_type != null && !FUEL_TYPES.includes(input.fuel_type)) {
    return `fuel_type must be one of ${FUEL_TYPES.join(', ')}`
  }
  if (input.dot_vehicle_class != null && !DOT_VEHICLE_CLASSES.includes(input.dot_vehicle_class)) {
    return `dot_vehicle_class must be one of ${DOT_VEHICLE_CLASSES.join(', ')}`
  }
  if (input.model_year != null) {
    if (!Number.isInteger(input.model_year) || input.model_year < 1900 || input.model_year > 2100) {
      return 'model_year must be a whole year between 1900 and 2100'
    }
  }
  for (const k of ['odometer_miles', 'gvwr_lbs'] as const) {
    const v = input[k]
    if (v != null && (typeof v !== 'number' || Number.isNaN(v) || v < 0)) {
      return `${k} must be a non-negative number`
    }
  }
  if (input.annual_dot_inspection_at != null && !ISO_DATE_RE.test(input.annual_dot_inspection_at)) {
    return 'annual_dot_inspection_at must be YYYY-MM-DD'
  }
  return null
}

/** Validate a single hazmat placard. */
export function validatePlacard(p: Partial<PlacardRow>): string | null {
  if (typeof p.hazard_class !== 'string' || !HAZARD_CLASSES.includes(p.hazard_class as HazardClass)) {
    return `hazard_class must be one of ${HAZARD_CLASSES.join(', ')}`
  }
  if (p.division != null && p.division !== '' && !/^\d(\.\d)?$/.test(p.division)) {
    return 'division must look like "1.1" or "5"'
  }
  if (p.un_number != null && p.un_number !== '' && !/^(UN)?\d{4}$/i.test(p.un_number.trim())) {
    return 'un_number must be a 4-digit UN id (e.g. UN1203)'
  }
  return null
}

/** Validate a scanned-document record (the file itself uploads separately). */
export function validateDocumentInput(d: Partial<DocumentRow>): string | null {
  if (typeof d.doc_type !== 'string' || !DOCUMENT_TYPES.includes(d.doc_type as DocumentType)) {
    return `doc_type must be one of ${DOCUMENT_TYPES.join(', ')}`
  }
  for (const k of ['issued_at', 'expires_at'] as const) {
    const v = d[k]
    if (v != null && v !== '' && !ISO_DATE_RE.test(v)) {
      return `${k} must be YYYY-MM-DD`
    }
  }
  if (d.issued_at && d.expires_at && d.expires_at < d.issued_at) {
    return 'expires_at cannot be before issued_at'
  }
  return null
}

// ── Hazmat consistency ─────────────────────────────────────────────────────
export interface HazmatCheck {
  /** True when carries_hazmat is set but no placards/chemicals back it up. */
  missingDetail: boolean
  /** True when placards/chemicals exist but the vehicle isn't flagged hazmat. */
  flagMismatch:  boolean
  messages:      string[]
}

/**
 * Cross-check the hazmat flag against the placards declared and the chemical
 * products linked from the SDS module. Surfaces (non-blocking) warnings so a
 * placarded vehicle without an SDS link, or a hazmat flag with nothing behind
 * it, gets flagged in the UI rather than silently shipping.
 */
export function checkHazmatConsistency(args: {
  carriesHazmat: boolean
  placardCount:  number
  chemicalCount: number
}): HazmatCheck {
  const { carriesHazmat, placardCount, chemicalCount } = args
  const messages: string[] = []
  const hasDetail = placardCount > 0 || chemicalCount > 0

  const missingDetail = carriesHazmat && !hasDetail
  const flagMismatch  = !carriesHazmat && hasDetail

  if (missingDetail) {
    messages.push('Marked as carrying hazmat, but no placards or linked chemicals are recorded.')
  }
  if (flagMismatch) {
    messages.push('Placards or chemicals are linked, but the vehicle is not marked as carrying hazmat.')
  }
  if (carriesHazmat && placardCount > 0 && chemicalCount === 0) {
    messages.push('Placards are set but no chemical product (SDS) is linked — link the SDS so responders can find it.')
  }
  return { missingDetail, flagMismatch, messages }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
