import { NextResponse } from 'next/server'
import type { FieldError } from '@soteria/core/hazardousWaste'
import {
  MANIFEST_STATUSES, validateManifestCreateInput,
  type HazardousWasteShipmentRow, type ManifestCreateInput, type ManifestStatus,
} from '@soteria/core/hazardousWasteManifest'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import {
  HAZARDOUS_WASTE_MODULE, SHIPMENT_COLUMNS, gateFailure, invalidInput, invalidJson, loadManifest, manifestDbError,
  presentManifests, readJsonObject, readManifestFields,
} from './_shared'

// GET  /api/hazardous-waste/manifests   List manifests at the active site, newest first, each WITH its
//                                       containers and its return-clock stage so the list needs no
//                                       second round-trip. ?status= narrows to one status; cancelled
//                                       manifests are left out unless ?include_cancelled=true or asked
//                                       for by status. ?limit= (default 50, at most 100) and ?offset=.
// POST /api/hazardous-waste/manifests   Draft a manifest for closed containers and put them in shipment,
//                                       in one transaction (hw_create_shipment, migration 317).

const DEFAULT_PAGE = 50
const MAX_PAGE = 100
/** Further than any list pages; a larger offset is a malformed request, not a 500 from PostgREST. */
const MAX_OFFSET = 100_000

function wholeNumber(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null
}

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, HAZARDOUS_WASTE_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const params = new URL(req.url).searchParams
  const status = params.get('status')?.trim() ?? ''
  const includeCancelled = params.get('include_cancelled') === 'true'
  const limit = wholeNumber(params.get('limit'), DEFAULT_PAGE, MAX_PAGE)
  const offset = wholeNumber(params.get('offset'), 0, MAX_OFFSET)
  const queryErrors: FieldError[] = []
  if (status && !(MANIFEST_STATUSES as readonly string[]).includes(status)) {
    queryErrors.push({ field: 'status', message: `Must be one of ${MANIFEST_STATUSES.join(', ')}` })
  }
  if (limit === null || limit < 1) queryErrors.push({ field: 'limit', message: `Must be a whole number from 1 to ${MAX_PAGE}` })
  if (offset === null) queryErrors.push({ field: 'offset', message: `Must be a whole number from 0 to ${MAX_OFFSET}` })
  if (queryErrors.length > 0 || limit === null || offset === null) return invalidInput(queryErrors)

  let query = gate.authedClient
    .from('hazardous_waste_shipments')
    .select(SHIPMENT_COLUMNS, { count: 'exact' })
    .eq('tenant_id', gate.tenantId)
  if (gate.facilityId) query = query.eq('facility_id', gate.facilityId)
  if (status) query = query.eq('status', status as ManifestStatus)
  else if (!includeCancelled) query = query.neq('status', 'cancelled')

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) return manifestDbError(error, 'hazardous-waste/manifests/GET')

  const rows = (data ?? []) as unknown as HazardousWasteShipmentRow[]
  const presented = await presentManifests(gate, rows, 'hazardous-waste/manifests/GET')
  if (!presented.ok) return presented.response

  const total = count ?? rows.length
  return NextResponse.json({
    manifests: presented.manifests,
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  })
}

export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, HAZARDOUS_WASTE_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { fields, errors: typeErrors } = readManifestFields(body)
  const rawIds = body.container_ids
  const idsAreText = Array.isArray(rawIds) && rawIds.every(id => typeof id === 'string')
  if (!idsAreText) typeErrors.push({ field: 'container_ids', message: 'Must be a list of container ids' })

  const input: ManifestCreateInput = {
    manifest_tracking_number: null, jurisdiction: 'federal', generator_category: '' as ManifestCreateInput['generator_category'],
    generator_epa_id: null, transporter_epa_id: null, tsdf_epa_id: null, transporter_name: null, tsdf_name: null,
    waste_codes: [], dot_description: null, electronic: false, notes: null,
    ...fields,
    container_ids: idsAreText ? (rawIds as string[]) : [],
  }
  const errors = [...typeErrors, ...validateManifestCreateInput(input)]
  if (errors.length > 0) return invalidInput(errors)

  const { container_ids: containerIds, ...manifestFields } = input
  const { data: id, error } = await gate.authedClient.rpc('hw_create_shipment', { p_container_ids: containerIds, p_fields: manifestFields })
  if (error) return manifestDbError(error, 'hazardous-waste/manifests/POST')

  // Read it back through the same scoping as every other read: the answer is what the caller can see.
  const created = await loadManifest(gate, id as string, 'hazardous-waste/manifests/POST read')
  if (!created.ok) return created.response
  return NextResponse.json({ manifest: created.manifest }, { status: 201 })
}
