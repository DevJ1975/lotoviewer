import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { validateVehicleInput, VEHICLE_STATUSES, type VehicleInput } from '@soteria/core/fleet'

// GET  /api/fleet/vehicles   List vehicles (any fleet member).
// POST /api/fleet/vehicles   Create a vehicle (admin/owner).

const VEHICLE_COLUMNS =
  'id, unit_number, make, model, model_year, vin, license_plate, license_plate_state, ' +
  'vehicle_type, status, photo_path, odometer_miles, usdot_number, mc_number, gvwr_lbs, ' +
  'dot_vehicle_class, annual_dot_inspection_at, ifta_registered, fuel_type, carries_hazmat, ' +
  'hazmat_notes, assigned_driver_id, home_location_text, notes, created_at, updated_at'

export async function GET(req: Request) {
  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  let query = gate.authedClient
    .from('fleet_vehicles')
    .select(VEHICLE_COLUMNS)
    .eq('tenant_id', gate.tenantId)
    .order('unit_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  const status = url.searchParams.get('status')
  if (status && VEHICLE_STATUSES.includes(status as never)) {
    query = query.eq('status', status)
  }
  const hazmat = url.searchParams.get('hazmat')
  if (hazmat === 'true') query = query.eq('carries_hazmat', true)

  const { data, error } = await query
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/vehicles/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ vehicles: data ?? [] })
}

export async function POST(req: Request) {
  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: VehicleInput
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const problem = validateVehicleInput(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const insert = {
    ...normalizeVehicle(body),
    tenant_id:  gate.tenantId,
    created_by: gate.userId,
  }

  const { data, error } = await gate.authedClient
    .from('fleet_vehicles')
    .insert(insert)
    .select(VEHICLE_COLUMNS)
    .single()
  if (error || !data) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A vehicle with that unit number or VIN already exists.' }, { status: 409 })
    }
    Sentry.captureException(error, { tags: { route: 'fleet/vehicles/POST' } })
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ vehicle: data }, { status: 201 })
}

// Whitelist + trim the writable columns so a client can't set tenant_id,
// id, or audit fields directly. Shared by POST + PATCH.
export function normalizeVehicle(body: VehicleInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v === null ? null : undefined)

  for (const k of [
    'unit_number', 'make', 'model', 'vin', 'license_plate', 'license_plate_state',
    'usdot_number', 'mc_number', 'dot_vehicle_class', 'fuel_type', 'hazmat_notes',
    'home_location_text', 'notes', 'photo_path', 'annual_dot_inspection_at',
  ] as const) {
    const v = text(body[k])
    if (v !== undefined) out[k] = v
  }
  if (body.vehicle_type !== undefined) out.vehicle_type = body.vehicle_type
  if (body.status !== undefined) out.status = body.status
  if (body.model_year !== undefined) out.model_year = body.model_year
  if (body.odometer_miles !== undefined) out.odometer_miles = body.odometer_miles
  if (body.gvwr_lbs !== undefined) out.gvwr_lbs = body.gvwr_lbs
  if (body.ifta_registered !== undefined) out.ifta_registered = !!body.ifta_registered
  if (body.carries_hazmat !== undefined) out.carries_hazmat = !!body.carries_hazmat
  if (body.assigned_driver_id !== undefined) out.assigned_driver_id = body.assigned_driver_id || null
  return out
}
