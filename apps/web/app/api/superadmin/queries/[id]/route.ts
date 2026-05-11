import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { SavedQueryRow } from '../route'

// PATCH  /api/superadmin/queries/[id] — partial edit ({ name?, description?, sql_text? })
// DELETE /api/superadmin/queries/[id]

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  const idNum = Number(id)
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: { name?: string; description?: string | null; sql_text?: string }
  try { body = (await req.json()) as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (name.length === 0 || name.length > 120) {
      return NextResponse.json({ error: 'name is 1-120 chars' }, { status: 400 })
    }
    patch.name = name
  }
  if (body.description !== undefined) {
    patch.description = body.description?.trim() || null
  }
  if (body.sql_text !== undefined) {
    const sqlText = body.sql_text.trim()
    if (sqlText.length === 0 || sqlText.length > 8000) {
      return NextResponse.json({ error: 'sql_text is 1-8000 chars' }, { status: 400 })
    }
    patch.sql_text = sqlText
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('saved_queries')
    .update(patch)
    .eq('id', idNum)
    .select('id, name, description, sql_text, created_by, updated_by, created_at, updated_at')
    .single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A saved query with that name already exists' }, { status: 409 })
    }
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Saved query not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ query: data as SavedQueryRow })
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  const idNum = Number(id)
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { error } = await admin.from('saved_queries').delete().eq('id', idNum)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
