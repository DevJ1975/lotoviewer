import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { validateDriverInput, type DriverInput } from '@soteria/core/fleetDriver'

// GET  /api/fleet/drivers   List driver profiles + roster name (member).
// POST /api/fleet/drivers   Create a driver profile for a roster worker (admin).

const DRIVER_SELECT = '*, loto_workers(id, full_name, employee_id)'

export async function GET(req: Request) {
  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  let query = gate.authedClient
    .from('fleet_driver_profiles')
    .select(DRIVER_SELECT)
    .eq('tenant_id', gate.tenantId)
    .order('created_at', { ascending: false })

  const status = url.searchParams.get('status')
  if (status && ['active', 'suspended', 'inactive'].includes(status)) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/drivers/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ drivers: data ?? [] })
}

export async function POST(req: Request) {
  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: DriverInput
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const problem = validateDriverInput(body, true)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const db = gate.authedClient
  // Confirm the worker belongs to the tenant.
  const { data: worker } = await db
    .from('loto_workers').select('id').eq('id', body.worker_id!).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!worker) return NextResponse.json({ error: 'Worker not found in this tenant.' }, { status: 400 })

  const insert = { ...normalizeDriver(body), worker_id: body.worker_id, tenant_id: gate.tenantId, created_by: gate.userId }
  const { data, error } = await db
    .from('fleet_driver_profiles')
    .insert(insert)
    .select(DRIVER_SELECT)
    .single()
  if (error || !data) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'This worker already has a driver profile.' }, { status: 409 })
    }
    Sentry.captureException(error, { tags: { route: 'fleet/drivers/POST' } })
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ driver: data }, { status: 201 })
}

// Whitelist writable driver columns (shared with PATCH).
export function normalizeDriver(body: DriverInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v === null ? null : undefined)

  for (const k of ['license_number', 'license_state', 'notes'] as const) {
    const v = text(body[k]); if (v !== undefined) out[k] = v
  }
  for (const k of [
    'license_expires_at', 'medical_card_expires_at',
    'hazmat_endorsement_expires_at', 'defensive_training_at',
  ] as const) {
    if (body[k] !== undefined) out[k] = body[k] || null
  }
  if (body.license_class !== undefined) out.license_class = body.license_class || null
  if (body.status !== undefined) out.status = body.status
  if (body.hazmat_endorsement !== undefined) out.hazmat_endorsement = !!body.hazmat_endorsement
  if (body.endorsements !== undefined) {
    out.endorsements = Array.isArray(body.endorsements)
      ? body.endorsements.map(e => String(e).trim()).filter(Boolean)
      : []
  }
  return out
}
