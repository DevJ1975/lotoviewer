import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { QUANTITY_UNITS } from '@soteria/core/fleet'

// GET /api/fleet/vehicles/:id/chemicals   List linked chemical products (member).
// PUT /api/fleet/vehicles/:id/chemicals   Replace the linked-chemical set (admin).
//
// Each link points at a chemical_products row so the Chemical Management /
// SDS module stays the single source of truth for the substance + its SDS.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ChemLinkInput {
  chemical_product_id?: string
  max_quantity?:        number | null
  quantity_unit?:       string | null
  un_number?:           string | null
  notes?:               string | null
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('fleet_vehicle_chemicals')
    .select('*, chemical_products(id, name, manufacturer, dot_un_number, dot_hazard_class, active_sds_id)')
    .eq('vehicle_id', id)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/chemicals/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ chemicals: data ?? [] })
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { chemicals?: ChemLinkInput[] }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const links = Array.isArray(body.chemicals) ? body.chemicals : []
  if (links.length > 100) return NextResponse.json({ error: 'Too many chemicals (max 100)' }, { status: 400 })
  for (const c of links) {
    if (typeof c.chemical_product_id !== 'string' || !UUID_RE.test(c.chemical_product_id)) {
      return NextResponse.json({ error: 'each chemical needs a valid chemical_product_id' }, { status: 400 })
    }
    if (c.quantity_unit != null && c.quantity_unit !== '' && !QUANTITY_UNITS.includes(c.quantity_unit as never)) {
      return NextResponse.json({ error: `quantity_unit must be one of ${QUANTITY_UNITS.join(', ')}` }, { status: 400 })
    }
    if (c.max_quantity != null && (typeof c.max_quantity !== 'number' || c.max_quantity < 0)) {
      return NextResponse.json({ error: 'max_quantity must be a non-negative number' }, { status: 400 })
    }
  }

  const db = gate.authedClient
  const { data: vehicle } = await db
    .from('fleet_vehicles').select('id').eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error: delErr } = await db.from('fleet_vehicle_chemicals').delete().eq('vehicle_id', id)
  if (delErr) {
    Sentry.captureException(delErr, { tags: { route: 'fleet/chemicals/PUT', stage: 'delete' } })
    return NextResponse.json({ error: delErr.message }, { status: 500 })
  }

  if (links.length > 0) {
    // Dedupe on chemical_product_id (the table has a unique constraint).
    const seen = new Set<string>()
    const rows = links.filter(c => {
      const key = c.chemical_product_id!
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map(c => ({
      tenant_id:           gate.tenantId,
      vehicle_id:          id,
      chemical_product_id: c.chemical_product_id,
      max_quantity:        c.max_quantity ?? null,
      quantity_unit:       c.quantity_unit || null,
      un_number:           c.un_number?.trim() || null,
      notes:               c.notes?.trim() || null,
      created_by:          gate.userId,
    }))
    const { error: insErr } = await db.from('fleet_vehicle_chemicals').insert(rows)
    if (insErr) {
      if (insErr.code === '23503') {
        return NextResponse.json({ error: 'One or more chemical products were not found.' }, { status: 400 })
      }
      Sentry.captureException(insErr, { tags: { route: 'fleet/chemicals/PUT', stage: 'insert' } })
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  const { data } = await db
    .from('fleet_vehicle_chemicals')
    .select('*, chemical_products(id, name, manufacturer, dot_un_number, dot_hazard_class, active_sds_id)')
    .eq('vehicle_id', id)
  return NextResponse.json({ chemicals: data ?? [] })
}
