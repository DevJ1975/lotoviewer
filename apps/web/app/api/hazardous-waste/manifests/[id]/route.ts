import { NextResponse } from 'next/server'
import { validateManifestFields } from '@soteria/core/hazardousWasteManifest'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import {
  HAZARDOUS_WASTE_MODULE, SHIPMENT_COLUMNS, UUID_RE, gateFailure, invalidInput, invalidJson, lifecycleFieldErrors, loadManifest,
  manifestDbError, notFound, readJsonObject, readManifestFields, type RouteContext,
} from '../_shared'

// GET   /api/hazardous-waste/manifests/[id]   One manifest with its containers, return clock, retention date
//                                             and whether the caller may edit it.
// PATCH /api/hazardous-waste/manifests/[id]   Edit a DRAFT's details: tracking number, parties, EPA IDs, waste
//                                             codes, shipping description, notes. Status and dates move only
//                                             through /transition; the database refuses an edit once the
//                                             manifest has shipped, whatever this route sends.

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, HAZARDOUS_WASTE_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const found = await loadManifest(gate, id, 'hazardous-waste/manifests/[id]/GET')
  if (!found.ok) return found.response
  return NextResponse.json({ manifest: found.manifest })
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, HAZARDOUS_WASTE_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const { fields, errors: typeErrors } = readManifestFields(body)
  const errors = [...lifecycleFieldErrors(body), ...typeErrors, ...validateManifestFields(fields)]
  if (errors.length > 0) return invalidInput(errors)
  if (Object.keys(fields).length === 0) return invalidInput([{ field: 'body', message: 'Nothing to change' }])

  let update = gate.authedClient
    .from('hazardous_waste_shipments')
    .update(fields)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
  if (gate.facilityId) update = update.eq('facility_id', gate.facilityId)
  const { data, error } = await update.select(SHIPMENT_COLUMNS).maybeSingle()
  if (error) return manifestDbError(error, 'hazardous-waste/manifests/[id]/PATCH')
  if (!data) return notFound()

  const updated = await loadManifest(gate, id, 'hazardous-waste/manifests/[id]/PATCH read')
  if (!updated.ok) return updated.response
  return NextResponse.json({ manifest: updated.manifest })
}
