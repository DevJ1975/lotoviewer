import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { validateJsonBody } from '@/lib/security/validateBody'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const CreateNoteSchema = z.object({
  version: z.string().trim().min(1).max(40),
  title:   z.string().trim().min(1).max(200),
  body_md: z.string().min(1).max(20_000),
  publish: z.boolean().optional().default(false),
})

// GET /api/superadmin/release-notes  → all rows (drafts + published)
// POST                                → create a new note
//
// Drafts have published_at IS NULL. Posting with publish=true sets
// published_at = now(); without it, the note is saved as a draft.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface ReleaseNoteRow {
  id:           number
  version:      string
  title:        string
  body_md:      string
  published_at: string | null
  created_at:   string
  updated_at:   string
  created_by:   string | null
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('release_notes')
    .select('id, version, title, body_md, published_at, created_at, updated_at, created_by')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: (data ?? []) as ReleaseNoteRow[] })
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const parsed = await validateJsonBody(req, CreateNoteSchema)
  if (!parsed.ok) return parsed.response
  const { version, title, body_md: bodyMd, publish } = parsed.data

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('release_notes')
    .insert({
      version,
      title,
      body_md:      bodyMd,
      published_at: publish ? new Date().toISOString() : null,
      created_by:   gate.userId,
    })
    .select('id, version, title, body_md, published_at, created_at, updated_at, created_by')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data as ReleaseNoteRow })
}
