import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH /api/prop65/assessments/[id] — sign an exposure assessment.
// Once signed=true, the record is the §25249.6 affirmative defense
// snapshot; further mutation is blocked by this route's business
// rule (the DB still permits superadmins to re-edit if absolutely
// necessary, since RLS is not a content lock).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext { params: Promise<{ id: string }> }

interface PatchBody {
  signed?:      unknown
  signed_name?: unknown
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const signed     = body.signed === true
  const signedName = typeof body.signed_name === 'string' ? body.signed_name.trim() : ''

  if (!signed)
    return NextResponse.json({ error: 'Only sign-off is supported via PATCH' }, { status: 400 })
  if (!signedName)
    return NextResponse.json({ error: 'signed_name required to sign' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('prop65_exposure_assessments')
      .select('id, signed')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    if (existing.signed)
      return NextResponse.json({ error: 'Assessment already signed' }, { status: 409 })

    const { data, error } = await admin
      .from('prop65_exposure_assessments')
      .update({ signed: true, signed_name: signedName, signed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('id, signed, signed_name, signed_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ assessment: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
