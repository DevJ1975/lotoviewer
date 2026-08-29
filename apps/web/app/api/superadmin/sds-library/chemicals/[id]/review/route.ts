import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/superadmin/sds-library/chemicals/[id]/review   { action: 'approve' | 'reject' }
//
// The superadmin gate that publishes an AI-seeded or tenant-promoted library
// entry (approve) or hides it (reject). Only approved entries are visible to
// tenants for adoption.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: { action?: unknown }
  try { body = (await req.json()) as { action?: unknown } }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('sds_library_chemicals')
    .update({
      review_status: action === 'approve' ? 'approved' : 'rejected',
      reviewed_by:   gate.userId,
      reviewed_at:   new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, review_status, reviewed_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Library chemical not found' }, { status: 404 })

  return NextResponse.json({ chemical: data })
}
