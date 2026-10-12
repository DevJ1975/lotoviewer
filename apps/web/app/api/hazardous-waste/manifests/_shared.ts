import { NextResponse } from 'next/server'
import type { FieldError } from '@soteria/core/hazardousWaste'
import {
  manifestRetentionEnd, manifestReturnClock, normalizeEpaId, normalizeTrackingNumber, normalizeWasteCodes,
  type HazardousWasteShipmentRow, type ManifestDraftFields, type ManifestJurisdiction,
} from '@soteria/core/hazardousWasteManifest'
import type { TenantModuleGate } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  canModifyManifest, type ManifestContainerRef, type ManifestDetail, type ManifestListItem,
} from '@/lib/hazardousWasteManifestView'

// What the /api/hazardous-waste/manifests routes share: reading the body, answering with
// field errors, turning a database refusal into the right status, and the reads that put a
// manifest together with its containers and its return clock. The rules are @soteria/core's.

export const HAZARDOUS_WASTE_MODULE = 'hazardous-waste'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type JsonObject = Record<string, unknown>
export type Gate = Extract<TenantModuleGate, { ok: true }>
export interface RouteContext { params: Promise<{ id: string }> }

export const SHIPMENT_COLUMNS =
  'id, tenant_id, facility_id, manifest_tracking_number, status, jurisdiction, generator_category, generator_epa_id, transporter_epa_id, ' +
  'tsdf_epa_id, transporter_name, tsdf_name, waste_codes, dot_description, electronic, shipped_on, completed_on, exception_reported_on, ' +
  'notes, created_by, created_at, updated_at'

export function gateFailure(gate: { status: number; message: string }): NextResponse {
  return NextResponse.json({ error: gate.message }, { status: gate.status })
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/** The request body when it is a JSON object, else null. */
export async function readJsonObject(req: Request): Promise<JsonObject | null> {
  try {
    const body: unknown = await req.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as JsonObject : null
  } catch {
    return null
  }
}

export function invalidJson(): NextResponse {
  return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
}

/** 400 with every problem at once, in the shape the forms read. */
export function invalidInput(errors: readonly FieldError[]): NextResponse {
  return NextResponse.json({
    error: errors.map(e => `${e.field}: ${e.message}`).join('; '),
    fieldErrors: errors,
  }, { status: 400 })
}

// ── Reading a body ──────────────────────────────────────────────────────────

type NullableTextField =
  | 'manifest_tracking_number' | 'generator_epa_id' | 'transporter_epa_id' | 'tsdf_epa_id'
  | 'transporter_name' | 'tsdf_name' | 'dot_description' | 'notes'

const identity = (value: string) => value

/**
 * The manifest fields present in a body, in the types the validators expect. A field that
 * is absent is left out (a PATCH sends only what changed); a blank one clears it. Whether a
 * value is acceptable is validateManifestFields's to say; this only refuses the wrong type.
 */
export function readManifestFields(body: JsonObject): { fields: Partial<ManifestDraftFields>; errors: FieldError[] } {
  const fields: Partial<ManifestDraftFields> = {}
  const errors: FieldError[] = []

  const nullableText = (key: NullableTextField, normalize: (value: string) => string = identity) => {
    if (!(key in body)) return
    const value = body[key]
    if (value === null || (typeof value === 'string' && value.trim() === '')) { fields[key] = null; return }
    if (typeof value !== 'string') { errors.push({ field: key, message: 'Must be text' }); return }
    fields[key] = normalize(value)
  }

  nullableText('manifest_tracking_number', normalizeTrackingNumber)
  nullableText('generator_epa_id', normalizeEpaId)
  nullableText('transporter_epa_id', normalizeEpaId)
  nullableText('tsdf_epa_id', normalizeEpaId)
  nullableText('transporter_name', value => value.trim())
  nullableText('tsdf_name', value => value.trim())
  nullableText('dot_description', value => value.trim())
  nullableText('notes', value => value.trim())

  if ('jurisdiction' in body) {
    if (typeof body.jurisdiction === 'string') fields.jurisdiction = body.jurisdiction.trim() as ManifestJurisdiction
    else errors.push({ field: 'jurisdiction', message: 'Must be text' })
  }
  if ('generator_category' in body) {
    if (typeof body.generator_category === 'string') fields.generator_category = body.generator_category.trim().toLowerCase() as ManifestDraftFields['generator_category']
    else errors.push({ field: 'generator_category', message: 'Must be text' })
  }
  if ('waste_codes' in body) {
    const codes = body.waste_codes
    if (Array.isArray(codes) && codes.every(code => typeof code === 'string')) fields.waste_codes = normalizeWasteCodes(codes)
    else errors.push({ field: 'waste_codes', message: 'Must be a list of codes' })
  }
  if ('electronic' in body) {
    if (typeof body.electronic === 'boolean') fields.electronic = body.electronic
    else errors.push({ field: 'electronic', message: 'Must be true or false' })
  }
  return { fields, errors }
}

const LIFECYCLE_FIELDS = ['status', 'shipped_on', 'completed_on', 'exception_reported_on'] as const

/** The fields that only the transition route may change. */
export function lifecycleFieldErrors(body: JsonObject): FieldError[] {
  return LIFECYCLE_FIELDS.filter(field => field in body).map(field => ({
    field, message: 'Cannot be set here. Ship, record the signed copy, file an exception report or cancel the manifest instead',
  }))
}

// ── Database refusals ───────────────────────────────────────────────────────

interface DbError { code?: string; message?: string; details?: string }

/** The constraint that keeps a container on one open manifest; its name is in the message PostgREST returns. */
const CONTAINER_ON_MANIFEST_CONSTRAINT = 'uq_hw_shipment_containers_on_manifest'

/** The migration's functions mark the messages they write for people (detail 'hw_manifest'). */
const PERSON_MESSAGE_DETAIL = 'hw_manifest'

/**
 * Not found and not allowed are plain; a refusal the database wrote for a person (a
 * container that is not closed, a date in the future) is passed on, because it says what to
 * do about it; a duplicate says which thing is a duplicate. Anything else, including a
 * constraint's own text, is the sanitizer's: it is logged, and the client is told nothing
 * about the schema.
 */
export function manifestDbError(error: DbError, route: string): NextResponse {
  if (error.code === 'P0002') return notFound()
  if (error.code === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (error.code === '23514' && error.details === PERSON_MESSAGE_DETAIL && error.message) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error.code === '23505') {
    const message = (error.message ?? '').includes(CONTAINER_ON_MANIFEST_CONSTRAINT)
      ? 'A container is already on another manifest'
      : 'Duplicate tracking number'
    return NextResponse.json({ error: message }, { status: 409 })
  }
  return sanitizeError(error, route)
}

// ── Reading manifests ───────────────────────────────────────────────────────

/** An embedded to-one comes back as an object or a one-element array, depending on how PostgREST infers it. */
function one<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

interface ContainerEmbed {
  id: string
  label: string
  status: ManifestContainerRef['status']
  stream?: { name: string } | { name: string }[] | null
}
interface ContainerLinkRow { shipment_id: string; container: ContainerEmbed | ContainerEmbed[] | null }

/** The containers on each of the given manifests, by manifest id. */
async function containersOf(
  gate: Gate, shipmentIds: string[],
): Promise<{ byShipment: Map<string, ManifestContainerRef[]>; error: DbError | null }> {
  const byShipment = new Map<string, ManifestContainerRef[]>()
  if (shipmentIds.length === 0) return { byShipment, error: null }

  const { data, error } = await gate.authedClient
    .from('hazardous_waste_shipment_containers')
    .select('shipment_id, container:container_id (id, label, status, stream:stream_id (name))')
    .eq('tenant_id', gate.tenantId)
    .in('shipment_id', shipmentIds)
  if (error) return { byShipment, error }

  for (const link of (data ?? []) as unknown as ContainerLinkRow[]) {
    const container = one(link.container)
    if (!container) continue
    const stream = one(container.stream)
    const list = byShipment.get(link.shipment_id) ?? []
    list.push({ id: container.id, label: container.label, status: container.status, stream_name: stream?.name ?? null })
    byShipment.set(link.shipment_id, list)
  }
  for (const list of byShipment.values()) list.sort((a, b) => a.label.localeCompare(b.label))
  return { byShipment, error: null }
}

function toListItem(row: HazardousWasteShipmentRow, containers: ManifestContainerRef[], now: Date): ManifestListItem {
  return {
    ...row,
    containers,
    clock: manifestReturnClock({
      generatorCategory: row.generator_category, jurisdiction: row.jurisdiction, status: row.status,
      shippedOn: row.shipped_on, completedOn: row.completed_on, exceptionReportedOn: row.exception_reported_on, now,
    }),
  }
}

/** Manifest rows with their containers and return clocks, as the list answers. */
export async function presentManifests(
  gate: Gate, rows: HazardousWasteShipmentRow[], route: string, now: Date = new Date(),
): Promise<{ ok: true; manifests: ManifestListItem[] } | { ok: false; response: NextResponse }> {
  const { byShipment, error } = await containersOf(gate, rows.map(row => row.id))
  if (error) return { ok: false, response: manifestDbError(error, route) }
  return { ok: true, manifests: rows.map(row => toListItem(row, byShipment.get(row.id) ?? [], now)) }
}

/** One manifest, scoped to the account and site, as the detail answers; or the response to send instead. */
export async function loadManifest(
  gate: Gate, id: string, route: string, now: Date = new Date(),
): Promise<{ ok: true; manifest: ManifestDetail } | { ok: false; response: NextResponse }> {
  let query = gate.authedClient.from('hazardous_waste_shipments').select(SHIPMENT_COLUMNS).eq('id', id).eq('tenant_id', gate.tenantId)
  if (gate.facilityId) query = query.eq('facility_id', gate.facilityId)
  const { data, error } = await query.maybeSingle()
  if (error) return { ok: false, response: manifestDbError(error, route) }
  if (!data) return { ok: false, response: notFound() }

  const row = data as unknown as HazardousWasteShipmentRow
  const presented = await presentManifests(gate, [row], route, now)
  if (!presented.ok) return presented
  return {
    ok: true,
    manifest: {
      ...presented.manifests[0]!,
      retention_end: manifestRetentionEnd(row.shipped_on),
      can_modify:    canModifyManifest(gate.role, gate.userId, row.created_by),
    },
  }
}
