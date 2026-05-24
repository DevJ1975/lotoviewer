import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { validatePlacard, type PlacardRow } from '@soteria/core/fleet'

// GET /api/fleet/vehicles/:id/placards   List placards (member).
// PUT /api/fleet/vehicles/:id/placards   Replace the full placard set (admin).
//
// Placards are a small bounded set per vehicle, so replace-all is simpler
// and race-free versus per-row create/delete.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('fleet_vehicle_placards')
    .select('*')
    .eq('vehicle_id', id)
    .order('hazard_class')
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/placards/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ placards: data ?? [] })
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { placards?: Partial<PlacardRow>[] }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const placards = Array.isArray(body.placards) ? body.placards : []
  if (placards.length > 30) return NextResponse.json({ error: 'Too many placards (max 30)' }, { status: 400 })
  for (const p of placards) {
    const problem = validatePlacard(p)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  }

  const db = gate.authedClient
  // Confirm the vehicle belongs to the tenant before mutating children.
  const { data: vehicle } = await db
    .from('fleet_vehicles').select('id').eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error: delErr } = await db.from('fleet_vehicle_placards').delete().eq('vehicle_id', id)
  if (delErr) {
    Sentry.captureException(delErr, { tags: { route: 'fleet/placards/PUT', stage: 'delete' } })
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  if (placards.length > 0) {
    const rows = placards.map(p => ({
      tenant_id:            gate.tenantId,
      vehicle_id:           id,
      hazard_class:         p.hazard_class,
      division:             trimOrNull(p.division),
      un_number:            normalizeUn(p.un_number),
      proper_shipping_name: trimOrNull(p.proper_shipping_name),
      placard_label:        trimOrNull(p.placard_label),
      notes:                trimOrNull(p.notes),
      created_by:           gate.userId,
    }))
    const { error: insErr } = await db.from('fleet_vehicle_placards').insert(rows)
    if (insErr) {
      Sentry.captureException(insErr, { tags: { route: 'fleet/placards/PUT', stage: 'insert' } })
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  const { data } = await db.from('fleet_vehicle_placards').select('*').eq('vehicle_id', id).order('hazard_class')
  return NextResponse.json({ placards: data ?? [] })
}

function trimOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function normalizeUn(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const digits = v.trim().replace(/^un/i, '')
  return `UN${digits}`
}
