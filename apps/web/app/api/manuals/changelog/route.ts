import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireManualReader } from '@/lib/manuals/auth'

// GET /api/manuals/changelog
//
// Master rollup. Time-ordered stream of every manual_versions row
// the caller is allowed to see. Drafts excluded for non-superadmins
// by inner-joining manuals.published_at IS NOT NULL.

export async function GET(req: Request) {
  const auth = await requireManualReader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 200))
  const moduleId = url.searchParams.get('module_id')?.trim() ?? null

  try {
    const admin = supabaseAdmin()

    // Fetch the visible manuals first so we can scope the version
    // query to their ids. Cheaper than a giant join when there are
    // ~10 manuals total.
    let manualQuery = admin
      .from('manuals')
      .select('id, module_id, title, published_at')
    if (!auth.isSuperadmin) manualQuery = manualQuery.not('published_at', 'is', null)
    if (moduleId) manualQuery = manualQuery.eq('module_id', moduleId)

    const { data: manuals, error: mErr } = await manualQuery
    if (mErr) throw new Error(mErr.message)
    type M = { id: string; module_id: string; title: string; published_at: string | null }
    const visible = ((manuals ?? []) as M[])
    if (visible.length === 0) return NextResponse.json({ entries: [] })

    const idToModule = new Map<string, M>()
    for (const m of visible) idToModule.set(m.id, m)

    const { data: versions, error: vErr } = await admin
      .from('manual_versions')
      .select('id, manual_id, version, title, change_note, created_at, created_by')
      .in('manual_id', visible.map(m => m.id))
      .order('created_at', { ascending: false })
      .limit(limit)
    if (vErr) throw new Error(vErr.message)

    type V = { id: string; manual_id: string; version: number; title: string; change_note: string | null; created_at: string; created_by: string | null }
    const rows = (versions ?? []) as V[]

    // Hydrate authors.
    const authorIds = Array.from(new Set(rows.map(r => r.created_by).filter((x): x is string => !!x)))
    const profileById = new Map<string, { full_name: string | null; email: string | null }>()
    if (authorIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', authorIds)
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
        profileById.set(p.id, { full_name: p.full_name, email: p.email })
      }
    }

    return NextResponse.json({
      entries: rows.map(r => {
        const m = idToModule.get(r.manual_id)
        const p = r.created_by ? profileById.get(r.created_by) : null
        return {
          id:            r.id,
          version:       r.version,
          manual_id:     r.manual_id,
          module_id:     m?.module_id ?? null,
          module_title:  m?.title ?? null,
          version_title: r.title,
          change_note:   r.change_note,
          created_at:    r.created_at,
          author_full_name: p?.full_name ?? null,
          author_email:     p?.email ?? null,
        }
      }),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals/changelog/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
