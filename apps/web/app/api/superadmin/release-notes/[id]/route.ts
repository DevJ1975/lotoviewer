import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PATCH  /api/superadmin/release-notes/[id]  → toggle publish, edit fields
// DELETE                                      → permanent delete (drafts only safe;
//                                               published notes can be unpublished
//                                               by setting publish=false)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  const idNum = Number(id)
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: { version?: unknown; title?: unknown; body_md?: unknown; publish?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.version === 'string') patch.version = body.version.trim()
  if (typeof body.title   === 'string') patch.title   = body.title.trim()
  if (typeof body.body_md === 'string') patch.body_md = body.body_md
  if (body.publish === true)            patch.published_at = new Date().toISOString()
  if (body.publish === false)           patch.published_at = null

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('release_notes')
    .update(patch)
    .eq('id', idNum)
    .select('id, version, title, body_md, published_at, created_at, updated_at, created_by')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  return NextResponse.json({ note: data })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  const idNum = Number(id)
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin.from('release_notes').delete().eq('id', idNum)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
