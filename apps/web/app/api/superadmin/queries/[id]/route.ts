import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { validateJsonBody } from '@/lib/security/validateBody'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { SavedQueryRow } from '../route'

// Partial-update: each field is optional. Description normalizes to
// null on empty-after-trim, matching the prior `description?.trim() || null`.
const UpdateQuerySchema = z.object({
  name:        z.string().trim().min(1).max(120).optional(),
  sql_text:    z.string().trim().min(1).max(8000).optional(),
  description: z.string().trim().max(1000).nullable().optional()
                 .transform(v => (v && v.length > 0 ? v : null)),
})

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

  const parsed = await validateJsonBody(req, UpdateQuerySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  if (body.name        !== undefined) patch.name        = body.name
  if (body.sql_text    !== undefined) patch.sql_text    = body.sql_text
  if (body.description !== undefined) patch.description = body.description

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
