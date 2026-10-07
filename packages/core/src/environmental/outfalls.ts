// Stormwater and discharge outfalls: validation of what a person enters.

export const OUTFALL_TYPES = ['stormwater', 'authorized_nsw', 'combined'] as const
export type OutfallType = typeof OUTFALL_TYPES[number]

export const OUTFALL_STATUSES = ['active', 'inactive', 'removed'] as const
export type OutfallStatus = typeof OUTFALL_STATUSES[number]

export interface OutfallInput {
  code:                       string
  name:                       string | null
  receivingWater:             string | null
  drainageArea:               string | null
  latitude:                   number | null
  longitude:                  number | null
  outfallType:                OutfallType
  status:                     OutfallStatus
  isSamplingPoint:            boolean
  substantiallyIdenticalTo:   string | null
  permitId:                   string | null
  notes:                      string | null
}

export type OutfallValidation =
  | { ok: true; outfall: OutfallInput }
  | { ok: false; errors: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/

/** Validate an outfall request body (snake_case, like the table). */
export function validateOutfall(input: unknown): OutfallValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['Expected an object.'] }
  const body = input as Record<string, unknown>
  const errors: string[] = []

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!CODE.test(code)) errors.push('code is required: 1-30 letters, digits, dots, dashes or underscores, such as "OF-001".')

  const text = (key: string, max: number): string | null => {
    const v = body[key]
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string') { errors.push(`${key} must be text.`); return null }
    const t = v.trim()
    if (t.length > max) { errors.push(`${key} is too long (the limit is ${max} characters).`); return null }
    return t || null
  }
  const enumOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = body[key]
    if (v === undefined) return fallback
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
    errors.push(`${key} must be one of: ${allowed.join(', ')}.`)
    return fallback
  }
  const coordinate = (key: string, min: number, max: number): number | null => {
    const v = body[key]
    if (v === undefined || v === null || v === '') return null
    const n = typeof v === 'number' ? v : Number.NaN
    if (!Number.isFinite(n) || n < min || n > max) { errors.push(`${key} must be a number between ${min} and ${max}.`); return null }
    return n
  }

  const latitude = coordinate('latitude', -90, 90)
  const longitude = coordinate('longitude', -180, 180)
  if ((latitude === null) !== (longitude === null) && !errors.some(e => e.startsWith('latitude') || e.startsWith('longitude'))) {
    errors.push('latitude and longitude go together: give both or neither.')
  }

  const uuidOrNull = (key: string): string | null => {
    const v = body[key]
    if (v === undefined || v === null || v === '') return null
    if (typeof v === 'string' && UUID.test(v)) return v.toLowerCase()
    errors.push(`${key} must be an id.`)
    return null
  }
  const isSamplingPoint = body.is_sampling_point === undefined ? false : body.is_sampling_point
  if (typeof isSamplingPoint !== 'boolean') errors.push('is_sampling_point must be true or false.')

  const outfall: OutfallInput = {
    code,
    name:                     text('name', 200),
    receivingWater:           text('receiving_water', 200),
    drainageArea:             text('drainage_area', 500),
    latitude,
    longitude,
    outfallType:              enumOf('outfall_type', OUTFALL_TYPES, 'stormwater'),
    status:                   enumOf('status', OUTFALL_STATUSES, 'active'),
    isSamplingPoint:          isSamplingPoint === true,
    substantiallyIdenticalTo: uuidOrNull('substantially_identical_to'),
    permitId:                 uuidOrNull('permit_id'),
    notes:                    text('notes', 2000),
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, outfall }
}
