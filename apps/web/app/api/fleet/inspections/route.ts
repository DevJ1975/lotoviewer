import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember } from '@/lib/fleet/gate'

// GET /api/fleet/inspections   Recent inspections across the fleet (member).
// Supports ?failedOnly=true to surface defects needing attention.

export async function GET(req: Request) {
  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  let query = gate.authedClient
    .from('fleet_vehicle_inspections')
    .select('id, vehicle_id, inspection_type, performed_at, passed, defects_noted, fleet_vehicles(unit_number, make, model)')
    .eq('tenant_id', gate.tenantId)
    .order('performed_at', { ascending: false })
    .limit(200)

  if (url.searchParams.get('failedOnly') === 'true') query = query.eq('passed', false)

  const { data, error } = await query
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/inspections/list/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ inspections: data ?? [] })
}
