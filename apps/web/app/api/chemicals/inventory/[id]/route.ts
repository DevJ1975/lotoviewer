import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  INVENTORY_STATUSES,
  CONTAINER_TYPES,
  INVENTORY_UNITS,
} from '@soteria/core/chemicals'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

const PATCHABLE = new Set([
  'location_id', 'department', 'quantity', 'unit', 'container_type',
  'received_date', 'opened_date', 'expiration_date',
  'lot_number', 'manufacture_date', 'status', 'assigned_to',
  'purchase_order', 'cost_cents', 'notes',
  'disposed_method',
])

const ENUM_FIELDS: Record<string, readonly string[]> = {
  status:         INVENTORY_STATUSES,
  container_type: CONTAINER_TYPES,
  unit:           INVENTORY_UNITS,
}

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_inventory_items')
      .select(`
        *,
        chemical_products (
          id, name, manufacturer, product_code,
          ghs_signal_word, ghs_pictograms, ppe_required,
          storage_class
        ),
        chemical_locations ( id, name, path, kind )
      `)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE.has(k)) continue
    if (k in ENUM_FIELDS && typeof v === 'string'
        && !ENUM_FIELDS[k].includes(v)) {
      return NextResponse.json({ error: `${k}: invalid value` }, { status: 400 })
    }
    update[k] = v
  }
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }
  if (update.status === 'disposed' && !update.disposed_method) {
    return NextResponse.json({ error: 'disposed_method is required when status = disposed' }, { status: 400 })
  }
  if (update.status === 'disposed') {
    update.disposed_by = gate.userId
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_inventory_items')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
