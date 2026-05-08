import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireManualReader } from '@/lib/manuals/auth'

// GET /api/manuals/search?q=...
//
// Postgres websearch_to_tsquery against the generated body_tsv column.
// Same shape as /api/safety-boards/search (migration 078). Returns
// title + snippet + module_id, ranked by ts_rank_cd computed
// client-side from the body match.

export async function GET(req: Request) {
  const auth = await requireManualReader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ hits: [] })

  try {
    const admin = supabaseAdmin()
    let query = admin
      .from('manuals')
      .select('id, module_id, title, summary, body_md, version, updated_at, published_at')
      .textSearch('body_tsv', q, { type: 'websearch' })
      .limit(50)
    if (!auth.isSuperadmin) query = query.not('published_at', 'is', null)
    const { data, error } = await query
    if (error) throw new Error(error.message)

    type Row = { id: string; module_id: string; title: string; summary: string | null; body_md: string; version: number; updated_at: string; published_at: string | null }
    const rows = ((data as unknown) as Row[]) ?? []

    // Cheap-and-cheerful snippet: first 220 chars of body around the
    // first matching token. ts_headline would be more accurate but
    // adds a second round-trip.
    const lc = q.toLowerCase()
    function snippet(body: string): string {
      if (!body) return ''
      const flat = body.replace(/\s+/g, ' ').trim()
      const idx = flat.toLowerCase().indexOf(lc.split(' ')[0] ?? '')
      const start = idx > 60 ? idx - 60 : 0
      const slice = flat.slice(start, start + 220)
      return (start > 0 ? '… ' : '') + slice + (start + 220 < flat.length ? ' …' : '')
    }

    return NextResponse.json({
      hits: rows.map(r => ({
        manual_id:  r.id,
        module_id:  r.module_id,
        title:      r.title,
        summary:    r.summary,
        snippet:    snippet(r.body_md),
        version:    r.version,
        updated_at: r.updated_at,
        is_draft:   !r.published_at,
      })),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals/search/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
