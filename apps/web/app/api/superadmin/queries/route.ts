import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { validateJsonBody } from '@/lib/security/validateBody'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const CreateBodySchema = z.object({
  name:        z.string().trim().min(1).max(120),
  sql_text:    z.string().trim().min(1).max(8000),
  description: z.string().trim().max(1000).nullable().optional()
                 .transform(v => (v && v.length > 0 ? v : null)),
})

// GET    /api/superadmin/queries — list saved queries
// POST   /api/superadmin/queries — create one ({ name, description?, sql_text })
//
// Mutations live alongside the read shape in this file so the admin UI
// only has one endpoint to remember; per-row PATCH/DELETE moves to
// /[id] route to keep the handler functions focused.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface SavedQueryRow {
  id:          number
  name:        string
  description: string | null
  sql_text:    string
  created_by:  string | null
  updated_by:  string | null
  created_at:  string
  updated_at:  string
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('saved_queries')
    .select('id, name, description, sql_text, created_by, updated_by, created_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ queries: (data ?? []) as SavedQueryRow[] })
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const parsed = await validateJsonBody(req, CreateBodySchema)
  if (!parsed.ok) return parsed.response
  const { name, sql_text: sqlText, description } = parsed.data

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('saved_queries')
    .insert({ name, description, sql_text: sqlText, created_by: gate.userId, updated_by: gate.userId })
    .select('id, name, description, sql_text, created_by, updated_by, created_at, updated_at')
    .single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A saved query with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ query: data as SavedQueryRow }, { status: 201 })
}
