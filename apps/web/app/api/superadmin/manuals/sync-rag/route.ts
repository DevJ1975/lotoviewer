import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncManualToRag, type ManualForSync } from '@/lib/ai/syncManualToRag'

// POST /api/superadmin/manuals/sync-rag
//
// Walk every manuals row and reconcile its RAG presence:
//   - published rows → ingest (or re-ingest if the body changed)
//   - draft rows     → remove any prior ingestion
//
// Idempotent. Safe to re-run after every release. Used to backfill
// after migration 108 published the first seven manuals (the PATCH
// hook only fires on subsequent edits, so a fresh seed needs this
// endpoint to enter the corpus).
//
// Returns a per-row report so the operator can see which manuals
// landed in RAG, which were skipped, and which failed. Errors on a
// single row are isolated — one Voyage outage on row 3 doesn't sink
// the rest of the batch.

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data: rows, error } = await admin
    .from('manuals')
    .select('id, module_id, title, summary, body_md, published_at, version')
    .order('module_id', { ascending: true })
  if (error) {
    Sentry.captureException(error, { tags: { route: 'manuals-sync-rag/POST' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const manuals = (rows ?? []) as ManualForSync[]
  const report: Array<{
    module_id: string
    action:    'ingested' | 'removed' | 'skipped' | 'error'
    error?:    string
    chunk_count?:   number
    voyage_tokens?: number
  }> = []

  let totalChunks = 0
  let totalVoyageTokens = 0
  let errored = 0

  for (const m of manuals) {
    try {
      const r = await syncManualToRag(m)
      report.push({
        module_id:     m.module_id,
        action:        r.action,
        chunk_count:   r.chunk_count,
        voyage_tokens: r.voyage_tokens,
      })
      totalChunks       += r.chunk_count   ?? 0
      totalVoyageTokens += r.voyage_tokens ?? 0
    } catch (e) {
      errored++
      const message = e instanceof Error ? e.message : String(e)
      Sentry.captureException(e, {
        tags: { route: 'manuals-sync-rag/POST', module_id: m.module_id },
      })
      report.push({ module_id: m.module_id, action: 'error', error: message })
    }
  }

  return NextResponse.json({
    scanned:           manuals.length,
    errored,
    total_chunks:      totalChunks,
    total_voyage_tokens: totalVoyageTokens,
    report,
  })
}
