import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { validateVehicleInput, type VehicleInput } from '@soteria/core/fleet'
import { normalizeVehicle } from '../route'

// GET    /api/fleet/vehicles/:id   Vehicle + placards + documents + chemicals.
// PATCH  /api/fleet/vehicles/:id   Update writable fields (admin/owner).
// DELETE /api/fleet/vehicles/:id   Remove the vehicle + children (admin/owner).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const db = gate.authedClient
  const [vehicle, placards, documents, chemicals] = await Promise.all([
    db.from('fleet_vehicles').select('*').eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle(),
    db.from('fleet_vehicle_placards').select('*').eq('vehicle_id', id).order('hazard_class'),
    db.from('fleet_vehicle_documents').select('*').eq('vehicle_id', id).order('doc_type'),
    db.from('fleet_vehicle_chemicals')
      .select('*, chemical_products(id, name, manufacturer, dot_un_number, dot_hazard_class, active_sds_id)')
      .eq('vehicle_id', id),
  ])

  if (vehicle.error) {
    Sentry.captureException(vehicle.error, { tags: { route: 'fleet/vehicles/[id]/GET' } })
    return NextResponse.json({ error: vehicle.error.message }, { status: 500 })
  }
  if (!vehicle.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    vehicle:   vehicle.data,
    placards:  placards.data ?? [],
    documents: documents.data ?? [],
    chemicals: chemicals.data ?? [],
  })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: VehicleInput
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // On patch, only validate identity if any identity field is being cleared
  // out entirely; otherwise validate the supplied subset.
  const problem = validateVehiclePatch(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const update = { ...normalizeVehicle(body), updated_by: gate.userId }
  const { data, error } = await gate.authedClient
    .from('fleet_vehicles')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('*')
    .single()
  if (error || !data) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A vehicle with that unit number or VIN already exists.' }, { status: 409 })
    }
    Sentry.captureException(error, { tags: { route: 'fleet/vehicles/[id]/PATCH' } })
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ vehicle: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { error } = await gate.authedClient
    .from('fleet_vehicles')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/vehicles/[id]/DELETE' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// A patch may legitimately omit identity fields (only touching, say, the
// odometer). Only run the full validator when the patch would leave the row
// without any identifier — otherwise validate the supplied enum/number fields.
function validateVehiclePatch(body: VehicleInput): string | null {
  const touchesIdentity =
    'unit_number' in body || 'vin' in body || 'license_plate' in body
  if (touchesIdentity) return validateVehicleInput(body)
  // Re-run the validator with a placeholder identity so the enum/number
  // checks still apply without tripping the "needs an identifier" rule.
  return validateVehicleInput({ ...body, unit_number: 'x' })
}
