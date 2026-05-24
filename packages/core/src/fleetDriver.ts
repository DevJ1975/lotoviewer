// Fleet Safety — driver licensing domain.
//
// A driver profile layers licensing / DOT-medical / hazmat-endorsement data
// onto an existing loto_workers roster row (worker_id), so people aren't
// duplicated. Pure module (no DOM / Node).

export const LICENSE_CLASSES = ['cdl_a', 'cdl_b', 'cdl_c', 'non_cdl', 'other'] as const
export type LicenseClass = typeof LICENSE_CLASSES[number]

export const DRIVER_STATUSES = ['active', 'suspended', 'inactive'] as const
export type DriverStatus = typeof DRIVER_STATUSES[number]

// Common CDL endorsements (49 CFR 383.93). Free-form is still allowed in the
// `endorsements` array; this list drives the picker UI.
export const KNOWN_ENDORSEMENTS = [
  'tanker', 'doubles_triples', 'passenger', 'school_bus', 'air_brakes',
] as const

export const LICENSE_CLASS_LABELS: Record<LicenseClass, string> = {
  cdl_a: 'CDL Class A', cdl_b: 'CDL Class B', cdl_c: 'CDL Class C',
  non_cdl: 'Non-CDL', other: 'Other',
}

export interface DriverRow {
  id:                            string
  tenant_id:                     string
  worker_id:                     string
  license_number:                string | null
  license_class:                 LicenseClass | null
  license_state:                 string | null
  license_expires_at:            string | null
  medical_card_expires_at:       string | null
  hazmat_endorsement:            boolean
  hazmat_endorsement_expires_at: string | null
  endorsements:                  string[]
  defensive_training_at:         string | null
  status:                        DriverStatus
  notes:                         string | null
  created_at:                    string
  updated_at:                    string
}

export interface DriverInput {
  worker_id?:                     string
  license_number?:                string | null
  license_class?:                 LicenseClass | null
  license_state?:                 string | null
  license_expires_at?:            string | null
  medical_card_expires_at?:       string | null
  hazmat_endorsement?:            boolean
  hazmat_endorsement_expires_at?: string | null
  endorsements?:                  string[]
  defensive_training_at?:         string | null
  status?:                        DriverStatus
  notes?:                         string | null
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate a driver create payload. `requireWorker` is true on create (the
 * roster link is mandatory) and false on patch. Returns the first problem,
 * or null when acceptable.
 */
export function validateDriverInput(input: DriverInput, requireWorker = true): string | null {
  if (requireWorker) {
    if (typeof input.worker_id !== 'string' || !UUID_RE.test(input.worker_id)) {
      return 'worker_id (a roster worker) is required'
    }
  }
  if (input.license_class != null && !LICENSE_CLASSES.includes(input.license_class)) {
    return `license_class must be one of ${LICENSE_CLASSES.join(', ')}`
  }
  if (input.status !== undefined && !DRIVER_STATUSES.includes(input.status)) {
    return `status must be one of ${DRIVER_STATUSES.join(', ')}`
  }
  for (const k of [
    'license_expires_at', 'medical_card_expires_at',
    'hazmat_endorsement_expires_at', 'defensive_training_at',
  ] as const) {
    const v = input[k]
    if (v != null && v !== '' && !ISO_DATE_RE.test(v)) {
      return `${k} must be YYYY-MM-DD`
    }
  }
  if (input.endorsements !== undefined) {
    if (!Array.isArray(input.endorsements) || input.endorsements.some(e => typeof e !== 'string')) {
      return 'endorsements must be an array of strings'
    }
  }
  // A hazmat endorsement without an expiry is allowed (some states don't
  // print one), but an expiry without the flag is contradictory.
  if (input.hazmat_endorsement === false && nonEmpty(input.hazmat_endorsement_expires_at)) {
    return 'hazmat_endorsement_expires_at set but hazmat_endorsement is false'
  }
  return null
}

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
