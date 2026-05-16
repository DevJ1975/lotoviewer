import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH /api/prop65/warnings/[id] — mark a warning removed
// (the sign was taken down or replaced). The row is preserved as
// historical evidence; the active_warnings_count rollup excludes
// rows with removed_at IS NOT NULL.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { remove?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.remove !== true)
    return NextResponse.json({ error: 'Only remove=true is supported via PATCH' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('prop65_warnings')
      .select('id, removed_at')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Warning not found' }, { status: 404 })
    if (existing.removed_at)
      return NextResponse.json({ error: 'Warning already removed' }, { status: 409 })

    const { data, error } = await admin
      .from('prop65_warnings')
      .update({
        removed_at:         new Date().toISOString(),
        removed_by_user_id: gate.userId,
      })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('id, removed_at, removed_by_user_id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ warning: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
