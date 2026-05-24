import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { validateDriverInput, type DriverInput } from '@soteria/core/fleetDriver'
import { normalizeDriver } from '../route'

// GET    /api/fleet/drivers/:id   Driver profile + roster name + assigned vehicles.
// PATCH  /api/fleet/drivers/:id   Update writable fields (admin/owner).
// DELETE /api/fleet/drivers/:id   Remove the driver profile (admin/owner).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DRIVER_SELECT = '*, loto_workers(id, full_name, employee_id)'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const db = gate.authedClient
  const [driver, vehicles] = await Promise.all([
    db.from('fleet_driver_profiles').select(DRIVER_SELECT).eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle(),
    db.from('fleet_vehicles').select('id, unit_number, make, model, status').eq('assigned_driver_id', id),
  ])
  if (driver.error) {
    Sentry.captureException(driver.error, { tags: { route: 'fleet/drivers/[id]/GET' } })
    return NextResponse.json({ error: driver.error.message }, { status: 500 })
  }
  if (!driver.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ driver: driver.data, vehicles: vehicles.data ?? [] })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: DriverInput
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const problem = validateDriverInput(body, false)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const update = { ...normalizeDriver(body), updated_by: gate.userId }
  const { data, error } = await gate.authedClient
    .from('fleet_driver_profiles')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select(DRIVER_SELECT)
    .single()
  if (error || !data) {
    Sentry.captureException(error, { tags: { route: 'fleet/drivers/[id]/PATCH' } })
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 })
  }
  return NextResponse.json({ driver: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { error } = await gate.authedClient
    .from('fleet_driver_profiles')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/drivers/[id]/DELETE' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
