import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { LOCATION_KINDS, type LocationKind } from '@soteria/core/chemicals'

// GET  /api/chemicals/locations  → tree as a flat array, ordered by path
// POST /api/chemicals/locations  → add a node (Building / Room / Cabinet…)

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_locations')
      .select('id, parent_id, name, kind, path, notes, archived_at, created_at')
      .eq('tenant_id', gate.tenantId)
      .order('path', { ascending: true, nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ locations: data ?? [] })
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

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (name.length > 120) return NextResponse.json({ error: 'name too long' }, { status: 400 })

  const kindRaw = typeof body.kind === 'string' ? body.kind : 'room'
  const kind: LocationKind = (LOCATION_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as LocationKind) : 'room'

  const parentId = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_locations')
      .insert({
        tenant_id:  gate.tenantId,
        parent_id:  parentId,
        name,
        kind,
        notes:      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        created_by: gate.userId,
        updated_by: gate.userId,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ location: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
