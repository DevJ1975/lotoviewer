import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireManualReader } from '@/lib/manuals/auth'
import { extractToc } from '@/lib/manuals/markdown'

// GET /api/manuals/[moduleId]
//
// Full manual body + a server-built TOC + the editor display name.
// Returns 404 to non-superadmins for draft manuals.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

interface RouteContext { params: Promise<{ moduleId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { moduleId } = await ctx.params
  if (!SLUG_RE.test(moduleId)) {
    return NextResponse.json({ error: 'Invalid moduleId' }, { status: 400 })
  }

  const auth = await requireManualReader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('manuals')
      .select('id, module_id, title, summary, body_md, version, published_at, created_at, updated_at, created_by, updated_by')
      .eq('module_id', moduleId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const m = data as null | {
      id: string; module_id: string; title: string; summary: string | null;
      body_md: string; version: number;
      published_at: string | null; created_at: string; updated_at: string;
      created_by: string | null; updated_by: string | null
    }
    if (!m) return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    if (!m.published_at && !auth.isSuperadmin) {
      return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    }

    // Hydrate the updated_by user (so the page footer shows
    // "Last updated by Jane Doe on …"). Best-effort; missing profile
    // means we render an em-dash.
    let editor: { full_name: string | null; email: string | null } | null = null
    if (m.updated_by) {
      const { data: profile } = await admin
        .from('profiles')
        .select('full_name, email')
        .eq('id', m.updated_by)
        .maybeSingle()
      editor = (profile as { full_name: string | null; email: string | null } | null) ?? null
    }

    return NextResponse.json({
      manual: {
        ...m,
        editor,
        toc: extractToc(m.body_md ?? ''),
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals/[id]/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
