import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/superadmin/manuals  — create a manual.
//   Body: { module_id, title, summary?, body_md?, published_at? }
//
// Used when a superadmin adds a manual outside the auto-bootstrap
// path (e.g. a new "platform admin" topic that isn't a feature in
// features.ts).

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: {
    module_id?: string; title?: string; summary?: string; body_md?: string;
    published_at?: string | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const moduleId = (body.module_id ?? '').trim().toLowerCase()
  const title    = (body.title ?? '').trim()
  if (!SLUG_RE.test(moduleId))   return NextResponse.json({ error: 'module_id must be lowercase a-z 0-9 -' }, { status: 400 })
  if (title.length < 1 || title.length > 200) return NextResponse.json({ error: 'title is required (1-200 chars)' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('manuals')
      .insert({
        module_id:    moduleId,
        title,
        summary:      (body.summary ?? '').trim() || null,
        body_md:      body.body_md ?? '',
        published_at: body.published_at ?? null,
        created_by:   gate.userId,
        updated_by:   gate.userId,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `A manual already exists for module_id "${moduleId}"` }, { status: 409 })
      }
      Sentry.captureException(error, { tags: { route: 'superadmin-manuals/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ manual: data }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin-manuals/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
