import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/prop65/links — confirm or create a prop65_chemical_links
// row. Used by /admin/prop65/chemicals to confirm auto-suggested CAS
// matches or to add a manual link.
//
// Body shape:
//   { chemical_inventory_id: uuid,
//     prop65_chemical_id:    uuid,
//     confidence:            'auto' | 'confirmed',
//     notes?:                string }
//
// Upserts on the unique triple (tenant, inventory item, p65 entry).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PostBody {
  chemical_inventory_id?: unknown
  prop65_chemical_id?:    unknown
  confidence?:            unknown
  notes?:                 unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const invId  = typeof body.chemical_inventory_id === 'string' ? body.chemical_inventory_id : ''
  const p65Id  = typeof body.prop65_chemical_id === 'string' ? body.prop65_chemical_id : ''
  const conf   = body.confidence === 'confirmed' ? 'confirmed' : 'auto'
  const notes  = typeof body.notes === 'string' ? body.notes : null

  if (!UUID_RE.test(invId))
    return NextResponse.json({ error: 'chemical_inventory_id must be a uuid' }, { status: 400 })
  if (!UUID_RE.test(p65Id))
    return NextResponse.json({ error: 'prop65_chemical_id must be a uuid' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('prop65_chemical_links')
      .upsert({
        tenant_id:               gate.tenantId,
        chemical_inventory_id:   invId,
        prop65_chemical_id:      p65Id,
        confidence:              conf,
        linked_by_user_id:       gate.userId,
        notes,
      }, { onConflict: 'tenant_id,chemical_inventory_id,prop65_chemical_id' })
      .select('id, tenant_id, chemical_inventory_id, prop65_chemical_id, confidence, linked_at, notes')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ link: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/prop65/links?id=<uuid> — drop a link (admin clears an
// auto-suggestion or revokes a confirmation).
export async function DELETE(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const id  = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('prop65_chemical_links')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
