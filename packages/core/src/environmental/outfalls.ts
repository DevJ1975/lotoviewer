// Stormwater and discharge outfalls: validation of what a person enters.

import { UUID_PATTERN } from './validation'

export const OUTFALL_TYPES = ['stormwater', 'authorized_nsw', 'combined'] as const
export type OutfallType = typeof OUTFALL_TYPES[number]

export const OUTFALL_STATUSES = ['active', 'inactive', 'removed'] as const
export type OutfallStatus = typeof OUTFALL_STATUSES[number]

export interface OutfallInput {
  facilityId:                 string
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
  photoPath:                  string | null
  notes:                      string | null
}

export type OutfallValidation =
  | { ok: true; outfall: OutfallInput }
  | { ok: false; errors: string[] }

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/

/**
 * Validate an outfall request body (snake_case, like the table). `photoPathPrefix`
 * is the folder the caller may reference: a photo path later becomes a signed URL,
 * so a path into someone else's folder is refused here, and with no prefix given
 * every photo path is refused. Left out of a partial update, a field keeps the
 * value in `current`.
 */
export function validateOutfall(
  input: unknown,
  options: { photoPathPrefix?: string; current?: OutfallInput } = {},
): OutfallValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: ['Expected an object.'] }
  const body = input as Record<string, unknown>
  const current = options.current
  const errors: string[] = []
  const has = (key: string) => body[key] !== undefined

  let facilityId = current?.facilityId ?? ''
  if (has('facility_id')) {
    if (typeof body.facility_id === 'string' && UUID_PATTERN.test(body.facility_id)) facilityId = body.facility_id.toLowerCase()
    else errors.push('facility_id must be an id.')
  }
  if (!facilityId && !errors.some(e => e.startsWith('facility_id'))) errors.push('facility_id is required: an outfall belongs to one site.')

  const code = has('code') ? (typeof body.code === 'string' ? body.code.trim() : '') : (current?.code ?? '')
  if (!CODE.test(code)) errors.push('code is required: 1-30 letters, digits, dots, dashes or underscores, such as "OF-001".')

  const text = (key: string, max: number, keep: string | null): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v !== 'string') { errors.push(`${key} must be text.`); return keep }
    const t = v.trim()
    if (t.length > max) { errors.push(`${key} is too long (the limit is ${max} characters).`); return keep }
    return t || null
  }
  const enumOf = <T extends string>(key: string, allowed: readonly T[], keep: T): T => {
    if (!has(key)) return keep
    if (typeof body[key] === 'string' && (allowed as readonly string[]).includes(body[key] as string)) return body[key] as T
    errors.push(`${key} must be one of: ${allowed.join(', ')}.`)
    return keep
  }
  const coordinate = (key: string, min: number, max: number, keep: number | null): number | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v
    errors.push(`${key} must be a number between ${min} and ${max}.`)
    return keep
  }
  const uuidOrNull = (key: string, keep: string | null): string | null => {
    if (!has(key)) return keep
    const v = body[key]
    if (v === null || v === '') return null
    if (typeof v === 'string' && UUID_PATTERN.test(v)) return v.toLowerCase()
    errors.push(`${key} must be an id.`)
    return keep
  }

  const latitude = coordinate('latitude', -90, 90, current?.latitude ?? null)
  const longitude = coordinate('longitude', -180, 180, current?.longitude ?? null)
  if ((latitude === null) !== (longitude === null) && !errors.some(e => e.startsWith('latitude') || e.startsWith('longitude'))) {
    errors.push('latitude and longitude go together: give both or neither.')
  }

  let isSamplingPoint = current?.isSamplingPoint ?? false
  if (has('is_sampling_point')) {
    if (typeof body.is_sampling_point === 'boolean') isSamplingPoint = body.is_sampling_point
    else errors.push('is_sampling_point must be true or false.')
  }

  let photoPath = current?.photoPath ?? null
  if (has('photo_path')) {
    const v = body.photo_path
    const prefix = options.photoPathPrefix
    if (v === null || v === '') photoPath = null
    else if (typeof v === 'string' && v.length <= 300 && !!prefix && v.startsWith(prefix) && !v.includes('..')) photoPath = v
    else errors.push('photo_path must be a file you uploaded to this account.')
  }

  const outfall: OutfallInput = {
    facilityId,
    code,
    name:                     text('name', 200, current?.name ?? null),
    receivingWater:           text('receiving_water', 200, current?.receivingWater ?? null),
    drainageArea:             text('drainage_area', 500, current?.drainageArea ?? null),
    latitude,
    longitude,
    outfallType:              enumOf('outfall_type', OUTFALL_TYPES, current?.outfallType ?? 'stormwater'),
    status:                   enumOf('status', OUTFALL_STATUSES, current?.status ?? 'active'),
    isSamplingPoint,
    substantiallyIdenticalTo: uuidOrNull('substantially_identical_to', current?.substantiallyIdenticalTo ?? null),
    permitId:                 uuidOrNull('permit_id', current?.permitId ?? null),
    photoPath,
    notes:                    text('notes', 2000, current?.notes ?? null),
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, outfall }
}

// ── table <-> domain ────────────────────────────────────────────────────────

/** The outfall as table columns. The inverse of parseOutfallRow. */
export function toOutfallRow(outfall: OutfallInput): Record<string, unknown> {
  return {
    facility_id:                outfall.facilityId,
    code:                       outfall.code,
    name:                       outfall.name,
    receiving_water:            outfall.receivingWater,
    drainage_area:              outfall.drainageArea,
    latitude:                   outfall.latitude,
    longitude:                  outfall.longitude,
    outfall_type:               outfall.outfallType,
    status:                     outfall.status,
    is_sampling_point:          outfall.isSamplingPoint,
    substantially_identical_to: outfall.substantiallyIdenticalTo,
    permit_id:                  outfall.permitId,
    photo_path:                 outfall.photoPath,
    notes:                      outfall.notes,
  }
}

/** A stored outfall row as the domain object, used as `current` for a partial update. */
export function parseOutfallRow(row: Record<string, unknown>): OutfallInput {
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  return {
    facilityId:               String(row.facility_id),
    code:                     String(row.code ?? ''),
    name:                     str(row.name),
    receivingWater:           str(row.receiving_water),
    drainageArea:             str(row.drainage_area),
    latitude:                 num(row.latitude),
    longitude:                num(row.longitude),
    outfallType:              row.outfall_type as OutfallType,
    status:                   row.status as OutfallStatus,
    isSamplingPoint:          row.is_sampling_point === true,
    substantiallyIdenticalTo: str(row.substantially_identical_to),
    permitId:                 str(row.permit_id),
    photoPath:                str(row.photo_path),
    notes:                    str(row.notes),
  }
}
