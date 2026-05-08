import { NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('bbs_qr_locations')
      .select('id, name, area, description, token, active, created_at, updated_at')
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ locations: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name        = typeof body.name === 'string' ? body.name.trim() : ''
  const area        = typeof body.area === 'string' ? body.area.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('bbs_qr_locations')
      .insert({
        tenant_id:   gate.tenantId,
        name,
        area:        area || null,
        description: description || null,
        created_by:  gate.userId,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ location: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
