import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

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

  let body: { version?: unknown; title?: unknown; body_md?: unknown; publish?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const version = typeof body.version === 'string' ? body.version.trim() : ''
  const title   = typeof body.title   === 'string' ? body.title.trim()   : ''
  const bodyMd  = typeof body.body_md === 'string' ? body.body_md        : ''
  const publish = body.publish === true

  if (!version) return NextResponse.json({ error: 'version required' }, { status: 400 })
  if (!title)   return NextResponse.json({ error: 'title required'   }, { status: 400 })
  if (!bodyMd)  return NextResponse.json({ error: 'body_md required' }, { status: 400 })

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
