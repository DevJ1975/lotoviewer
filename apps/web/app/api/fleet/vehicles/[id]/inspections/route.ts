import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember } from '@/lib/fleet/gate'
import {
  evaluateInspection, validateInspection,
  type ChecklistItem, type InspectionType,
} from '@soteria/core/fleetInspection'

// GET  /api/fleet/vehicles/:id/inspections   List inspections (member).
// POST /api/fleet/vehicles/:id/inspections   Record a pre-trip inspection.
//
// Any tenant member can run + log an inspection. A failed inspection flips
// the vehicle to out_of_service — done explicitly here (not a DB trigger) so
// the side effect is visible at the call site.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('fleet_vehicle_inspections')
    .select('*, fleet_driver_profiles(id, loto_workers(full_name))')
    .eq('vehicle_id', id)
    .order('performed_at', { ascending: false })
    .limit(100)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/inspections/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ inspections: data ?? [] })
}

interface PostBody {
  inspection_type?: InspectionType
  items?:           ChecklistItem[]
  driver_id?:       string | null
  odometer_miles?:  number | null
  performed_at?:    string
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const problem = validateInspection(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const db = gate.authedClient
  const { data: vehicle } = await db
    .from('fleet_vehicles').select('id, status').eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { passed, defectSummary } = evaluateInspection(body.items ?? [])

  const { data: inspection, error } = await db
    .from('fleet_vehicle_inspections')
    .insert({
      tenant_id:       gate.tenantId,
      vehicle_id:      id,
      driver_id:       body.driver_id || null,
      inspection_type: body.inspection_type ?? 'pre_trip',
      performed_at:    body.performed_at || new Date().toISOString(),
      odometer_miles:  body.odometer_miles ?? null,
      items:           body.items,
      passed,
      defects_noted:   defectSummary,
      created_by:      gate.userId,
    })
    .select('*')
    .single()
  if (error || !inspection) {
    Sentry.captureException(error, { tags: { route: 'fleet/inspections/POST' } })
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  // A failed pre-trip check takes the vehicle out of service (best-effort;
  // the inspection itself is the system of record and already succeeded).
  let vehicleOutOfService = false
  if (!passed && vehicle.status === 'active') {
    const { error: updErr } = await db
      .from('fleet_vehicles')
      .update({ status: 'out_of_service', updated_by: gate.userId })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
    if (updErr) Sentry.captureException(updErr, { tags: { route: 'fleet/inspections/POST', stage: 'oos' } })
    else vehicleOutOfService = true
  }

  return NextResponse.json({ inspection, passed, vehicleOutOfService }, { status: 201 })
}
