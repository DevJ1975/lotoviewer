import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }
  if (typeof body.name === 'string')        update.name = body.name.trim()
  if (typeof body.area === 'string')        update.area = body.area.trim() || null
  if (typeof body.description === 'string') update.description = body.description.trim() || null
  if (typeof body.active === 'boolean')     update.active = body.active
  if (body.rotate_token === true)           update.token = randomBytes(16).toString('hex')

  if (Object.keys(update).length <= 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('bbs_qr_locations')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ location: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
