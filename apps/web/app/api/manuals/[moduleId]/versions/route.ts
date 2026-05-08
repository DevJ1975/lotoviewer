import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireManualReader } from '@/lib/manuals/auth'

// GET /api/manuals/[moduleId]/versions
//
// Per-manual changelog. Returns version metadata only (no body) so the
// page renders fast; the diff view fetches a single version's body
// via the [versionId] route below.

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
    const { data: m } = await admin
      .from('manuals')
      .select('id, published_at')
      .eq('module_id', moduleId)
      .maybeSingle()
    const manual = m as { id: string; published_at: string | null } | null
    if (!manual) return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    if (!manual.published_at && !auth.isSuperadmin) {
      return NextResponse.json({ error: 'Manual not found' }, { status: 404 })
    }

    const { data: versions, error } = await admin
      .from('manual_versions')
      .select('id, version, title, summary, change_note, created_at, created_by')
      .eq('manual_id', manual.id)
      .order('version', { ascending: false })
      .limit(200)
    if (error) throw new Error(error.message)

    // Hydrate authors.
    type Row = { id: string; version: number; title: string; summary: string | null; change_note: string | null; created_at: string; created_by: string | null }
    const rows = (versions ?? []) as Row[]
    const ids = Array.from(new Set(rows.map(r => r.created_by).filter((x): x is string => !!x)))
    const profileById = new Map<string, { full_name: string | null; email: string | null }>()
    if (ids.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids)
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
        profileById.set(p.id, { full_name: p.full_name, email: p.email })
      }
    }

    return NextResponse.json({
      versions: rows.map(r => {
        const p = r.created_by ? profileById.get(r.created_by) : null
        return {
          ...r,
          author_full_name: p?.full_name ?? null,
          author_email: p?.email ?? null,
        }
      }),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals/[id]/versions/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
