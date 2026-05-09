import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chunkText } from '@/lib/ai/chunker'
import { embed, vectorLiteral, VoyageNotConfiguredError } from '@/lib/ai/embeddings'

// POST /api/superadmin/knowledge/seed-regulations
//
// One-off bootstrap endpoint: walks the manifest below, reads each
// markdown file from apps/web/seed/, chunks + embeds, and inserts as
// `source_type = 'regulation'` rows in knowledge_documents (with
// tenant_id = NULL so every tenant's RAG sees them).
//
// Idempotent: each manifest entry uses a stable content_sha256 derived
// from its key, so re-running the endpoint deletes the prior rows
// (cascade clears chunks via FK) and inserts fresh. Useful when a seed
// file is updated.
//
// This is a deliberately minimal endpoint — it doesn't try to be a
// general-purpose markdown ingestor. The /superadmin/policies/upload
// flow handles user-uploaded markdown via Supabase Storage staging;
// this seed endpoint covers regulation source material we ship with
// the platform.

export const runtime     = 'nodejs'
export const maxDuration = 300

interface SeedEntry {
  /** Stable key — drives the synthetic content_sha256 so re-runs
   *  upsert correctly. */
  key:           string
  /** File under apps/web/seed/. */
  file:          string
  title:         string
  jurisdiction:  string | null
  source_url:    string | null
  source_type:   'regulation' | 'state_reg' | 'dot' | 'epa' | 'rcra'
  /** Optional ISO date — surfaces in citations. */
  effective_date: string | null
}

const MANIFEST: SeedEntry[] = [
  {
    key:            'osha-29-cfr-1910-1200-hazcom-001-250',
    file:           '29-cfr-1910-1200-hazcom-001-250.md',
    title:          '29 CFR 1910.1200 — Hazard Communication (pages 1-250)',
    jurisdiction:   'federal',
    source_url:     'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200',
    source_type:    'regulation',
    effective_date: '2026-01-08',
  },
]

function syntheticSha(key: string): string {
  // Same shape as syncManualToRag — stable hex per key.
  const seed = `soteria-seed:${key}`
  let hex = ''
  for (let i = 0; i < seed.length; i++) hex += seed.charCodeAt(i).toString(16).padStart(2, '0')
  return hex.padEnd(64, '0').slice(0, 64)
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const seedDir = path.join(process.cwd(), 'seed')

  const report: Array<{
    key:           string
    action:        'ingested' | 'error'
    error?:        string
    chunk_count?:  number
    voyage_tokens?: number
  }> = []

  let totalChunks = 0
  let totalVoyageTokens = 0
  let errored = 0

  for (const entry of MANIFEST) {
    try {
      const filePath = path.join(seedDir, entry.file)
      const text = (await fs.readFile(filePath, 'utf-8')).trim()
      if (!text) {
        report.push({ key: entry.key, action: 'error', error: 'seed file is empty' })
        errored++
        continue
      }

      const chunks = chunkText({ text })
      if (chunks.length === 0) {
        report.push({ key: entry.key, action: 'error', error: 'chunker produced 0 chunks' })
        errored++
        continue
      }

      let embeddings: number[][]
      let voyageTokens = 0
      try {
        const r = await embed({ texts: chunks.map(c => c.text), inputType: 'document' })
        embeddings = r.embeddings
        voyageTokens = r.totalTokens
      } catch (err) {
        if (err instanceof VoyageNotConfiguredError) {
          report.push({ key: entry.key, action: 'error', error: 'VOYAGE_API_KEY is not configured' })
          errored++
          continue
        }
        throw err
      }
      if (embeddings.length !== chunks.length) {
        report.push({ key: entry.key, action: 'error', error: `embedding count mismatch (${embeddings.length} vs ${chunks.length})` })
        errored++
        continue
      }

      const sha = syntheticSha(entry.key)

      // Replace any prior row for this seed key. Cascade on
      // knowledge_chunks clears the chunks at the same time.
      const { error: delErr } = await admin
        .from('knowledge_documents')
        .delete()
        .is('tenant_id', null)
        .eq('source_type', entry.source_type)
        .eq('content_sha256', sha)
      if (delErr) {
        report.push({ key: entry.key, action: 'error', error: `prior-row delete failed: ${delErr.message}` })
        errored++
        continue
      }

      const { data: doc, error: docErr } = await admin
        .from('knowledge_documents')
        .insert({
          tenant_id:      null,
          source_type:    entry.source_type,
          title:          entry.title,
          jurisdiction:   entry.jurisdiction,
          effective_date: entry.effective_date,
          source_url:     entry.source_url,
          uploaded_by:    null,
          content_sha256: sha,
          chunk_count:    chunks.length,
        })
        .select('id')
        .maybeSingle()
      if (docErr || !doc) {
        report.push({ key: entry.key, action: 'error', error: `document insert failed: ${docErr?.message ?? 'no row'}` })
        errored++
        continue
      }

      const rows = chunks.map((c, i) => ({
        document_id: doc.id,
        chunk_index: c.index,
        text:        c.text,
        embedding:   vectorLiteral(embeddings[i]),
        token_count: c.tokenEst,
        metadata: {
          seed_key:   entry.key,
          start_char: c.startChar,
          end_char:   c.endChar,
        },
      }))

      let chunkInsertFailed = false
      for (let i = 0; i < rows.length; i += 200) {
        const slice = rows.slice(i, i + 200)
        const { error: chunkErr } = await admin.from('knowledge_chunks').insert(slice)
        if (chunkErr) {
          await admin.from('knowledge_documents').delete().eq('id', doc.id)
          report.push({ key: entry.key, action: 'error', error: `chunk insert failed: ${chunkErr.message}` })
          errored++
          chunkInsertFailed = true
          break
        }
      }
      if (chunkInsertFailed) continue

      report.push({
        key:           entry.key,
        action:        'ingested',
        chunk_count:   chunks.length,
        voyage_tokens: voyageTokens,
      })
      totalChunks       += chunks.length
      totalVoyageTokens += voyageTokens
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      Sentry.captureException(e, { tags: { route: 'knowledge-seed/POST', key: entry.key } })
      report.push({ key: entry.key, action: 'error', error: message })
      errored++
    }
  }

  return NextResponse.json({
    scanned:             MANIFEST.length,
    errored,
    total_chunks:        totalChunks,
    total_voyage_tokens: totalVoyageTokens,
    report,
  })
}
