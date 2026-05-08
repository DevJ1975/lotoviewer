import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { INVENTORY_UNITS, type InventoryUnit } from '@soteria/core/chemicals'

// GET  /api/chemicals/maq   List rules + their current rollup status.
// POST /api/chemicals/maq   Add a new rule.
//
// Each rule applies to one of:
//   - storage_class (e.g. 'flammable') — matches every product whose
//     products.storage_class ILIKEs the rule's text.
//   - product_id — applies to that specific chemical anywhere it lives.
// One field must be set, not both — enforced by a CHECK in migration 086.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const [rulesRes, statusRes] = await Promise.all([
      gate.authedClient
        .from('chemical_max_allowable_quantities')
        .select(`
          id, tenant_id, location_id, storage_class, product_id,
          unit, max_quantity, reference, notes, created_at,
          chemical_locations ( id, name, path ),
          chemical_products  ( id, name, manufacturer )
        `)
        .eq('tenant_id', gate.tenantId)
        .order('created_at', { ascending: false }),
      gate.authedClient
        .from('v_chemical_maq_status')
        .select('rule_id, total_in_unit, headroom, exceeds_cap, containers_in_other_units')
        .eq('tenant_id', gate.tenantId),
    ])
    if (rulesRes.error)  return NextResponse.json({ error: rulesRes.error.message },  { status: 500 })
    if (statusRes.error) return NextResponse.json({ error: statusRes.error.message }, { status: 500 })

    const statusByRule = new Map((statusRes.data ?? []).map(s => [s.rule_id, s]))
    const rows = (rulesRes.data ?? []).map(r => ({
      ...r,
      status: statusByRule.get(r.id) ?? null,
    }))

    return NextResponse.json({
      rules:           rows,
      total:           rows.length,
      exceeded_count:  rows.filter(r => r.status?.exceeds_cap).length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const storageClass = typeof body.storage_class === 'string' && body.storage_class.trim()
    ? body.storage_class.trim().toLowerCase()
    : null
  const productId = typeof body.product_id === 'string' && body.product_id.trim()
    ? body.product_id.trim()
    : null

  if ((storageClass && productId) || (!storageClass && !productId)) {
    return NextResponse.json({
      error: 'Provide exactly one of storage_class or product_id',
    }, { status: 400 })
  }
  if (productId && !UUID_RE.test(productId)) {
    return NextResponse.json({ error: 'Invalid product_id' }, { status: 400 })
  }

  const locationId = typeof body.location_id === 'string' && body.location_id
    ? body.location_id
    : null
  if (locationId && !UUID_RE.test(locationId)) {
    return NextResponse.json({ error: 'Invalid location_id' }, { status: 400 })
  }

  const unitRaw = typeof body.unit === 'string' ? body.unit : ''
  if (!(INVENTORY_UNITS as readonly string[]).includes(unitRaw) || unitRaw === 'other') {
    return NextResponse.json({
      error: `unit must be one of: ${INVENTORY_UNITS.filter(u => u !== 'other').join(', ')}`,
    }, { status: 400 })
  }
  const unit = unitRaw as Exclude<InventoryUnit, 'other'>

  const maxQuantity = typeof body.max_quantity === 'number'
    ? body.max_quantity
    : Number.parseFloat(String(body.max_quantity ?? ''))
  if (!Number.isFinite(maxQuantity) || maxQuantity <= 0) {
    return NextResponse.json({ error: 'max_quantity must be a positive number' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Confirm referenced product/location belong to this tenant.
    if (productId) {
      const { data: p } = await admin
        .from('chemical_products')
        .select('id')
        .eq('id', productId)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      if (!p) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    if (locationId) {
      const { data: l } = await admin
        .from('chemical_locations')
        .select('id')
        .eq('id', locationId)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      if (!l) return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const { data, error } = await admin
      .from('chemical_max_allowable_quantities')
      .insert({
        tenant_id:    gate.tenantId,
        location_id:  locationId,
        storage_class: storageClass,
        product_id:   productId,
        unit,
        max_quantity: maxQuantity,
        reference:    typeof body.reference === 'string' && body.reference.trim() ? body.reference.trim() : null,
        notes:        typeof body.notes === 'string' && body.notes.trim()       ? body.notes.trim()       : null,
        created_by:   gate.userId,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rule: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
