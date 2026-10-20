import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chunkText } from '@/lib/ai/chunker'
import { embed, vectorLiteral, VoyageNotConfiguredError } from '@/lib/ai/embeddings'
import { LOTO_COACH_KB, readCoachKbDoc, type CoachKbDoc } from '@/lib/strike/kb/loto'

export const runtime     = 'nodejs'
export const maxDuration = 300

// POST /api/superadmin/strike/coach-kb
//
// Ingests the LOTO Coach knowledge base (lib/strike/kb/loto/*.md) into
// knowledge_documents + knowledge_chunks as global (tenant_id NULL)
// 'training' documents, so every tenant's coach can cite them.
//
// Idempotent, like seed-regulations: each file has a stable key that drives
// a synthetic content_sha256, so a re-run deletes the prior document (the FK
// cascade clears its chunks) and inserts fresh. Re-run after editing a file.

const SOURCE_TYPE = 'training' as const

function syntheticSha(key: string): string {
  const seed = `soteria-strike-kb:${key}`
  let hex = ''
  for (let i = 0; i < seed.length; i++) hex += seed.charCodeAt(i).toString(16).padStart(2, '0')
  return hex.padEnd(64, '0').slice(0, 64)
}

interface IngestReport {
  key: string
  action: 'ingested' | 'error'
  error?: string
  chunk_count?: number
  voyage_tokens?: number
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const report: IngestReport[] = []
  for (const doc of LOTO_COACH_KB) {
    try {
      report.push(await ingest(doc))
    } catch (err) {
      if (err instanceof VoyageNotConfiguredError) {
        return NextResponse.json({ error: 'VOYAGE_API_KEY is not configured.' }, { status: 503 })
      }
      Sentry.captureException(err, { tags: { route: '/api/superadmin/strike/coach-kb', key: doc.key } })
      report.push({ key: doc.key, action: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const errored = report.filter(r => r.action === 'error').length
  return NextResponse.json({
    ingested: report.length - errored,
    errored,
    total_chunks: report.reduce((sum, r) => sum + (r.chunk_count ?? 0), 0),
    total_voyage_tokens: report.reduce((sum, r) => sum + (r.voyage_tokens ?? 0), 0),
    report,
  }, { status: errored > 0 ? 207 : 200 })
}

async function ingest(doc: CoachKbDoc): Promise<IngestReport> {
  const text = readCoachKbDoc(doc).trim()
  if (!text) return { key: doc.key, action: 'error', error: 'file is empty' }

  const chunks = chunkText({ text })
  if (chunks.length === 0) return { key: doc.key, action: 'error', error: 'chunker produced 0 chunks' }

  const { embeddings, totalTokens } = await embed({ texts: chunks.map(c => c.text), inputType: 'document' })
  if (embeddings.length !== chunks.length) {
    return { key: doc.key, action: 'error', error: `embedding count mismatch (${embeddings.length} vs ${chunks.length})` }
  }

  const admin = supabaseAdmin()
  const sha = syntheticSha(doc.key)

  const { error: delErr } = await admin
    .from('knowledge_documents')
    .delete()
    .is('tenant_id', null)
    .eq('source_type', SOURCE_TYPE)
    .eq('content_sha256', sha)
  if (delErr) throw new Error(`prior-row delete failed: ${delErr.message}`)

  const { data: inserted, error: docErr } = await admin
    .from('knowledge_documents')
    .insert({
      tenant_id:      null,
      source_type:    SOURCE_TYPE,
      title:          doc.title,
      jurisdiction:   null,
      effective_date: null,
      source_url:     'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-J/section-1910.147',
      uploaded_by:    null,
      content_sha256: sha,
      chunk_count:    chunks.length,
    })
    .select('id')
    .maybeSingle()
  if (docErr || !inserted) throw new Error(`document insert failed: ${docErr?.message ?? 'no row'}`)

  const rows = chunks.map((c, i) => ({
    document_id: inserted.id,
    chunk_index: c.index,
    text:        c.text,
    embedding:   vectorLiteral(embeddings[i]),
    token_count: c.tokenEst,
    metadata:    { kb_key: doc.key, section: doc.section, start_char: c.startChar, end_char: c.endChar },
  }))

  const { error: chunkErr } = await admin.from('knowledge_chunks').insert(rows)
  if (chunkErr) {
    await admin.from('knowledge_documents').delete().eq('id', inserted.id)
    throw new Error(`chunk insert failed: ${chunkErr.message}`)
  }

  return { key: doc.key, action: 'ingested', chunk_count: chunks.length, voyage_tokens: totalTokens }
}
