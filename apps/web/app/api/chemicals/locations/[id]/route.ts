import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { LOCATION_KINDS, type LocationKind } from '@soteria/core/chemicals'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }
  if (typeof body.name === 'string' && body.name.trim()) update.name = body.name.trim()
  if (typeof body.kind === 'string'
      && (LOCATION_KINDS as readonly string[]).includes(body.kind)) {
    update.kind = body.kind as LocationKind
  }
  if (body.parent_id === null
      || (typeof body.parent_id === 'string' && UUID_RE.test(body.parent_id))) {
    if (body.parent_id === id) {
      return NextResponse.json({ error: 'Location cannot be its own parent' }, { status: 400 })
    }
    update.parent_id = body.parent_id
  }
  if (typeof body.notes === 'string') update.notes = body.notes.trim() || null

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_locations')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ location: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()

    // Refuse to delete a location that still has active inventory in it —
    // forces the user to move/dispose containers first.
    const { count } = await admin
      .from('chemical_inventory_items')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', gate.tenantId)
      .eq('location_id', id)
      .in('status', ['requested', 'in_stock', 'in_use', 'quarantined'])
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: `Location has ${count} active container${count === 1 ? '' : 's'}. Move or dispose them first.`,
      }, { status: 409 })
    }

    const { data, error } = await admin
      .from('chemical_locations')
      .update({ archived_at: new Date().toISOString(), updated_by: gate.userId })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found or already archived' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
