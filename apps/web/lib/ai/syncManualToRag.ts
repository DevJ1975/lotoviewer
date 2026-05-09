// Sync a published manual into the RAG knowledge base.
//
// When a superadmin publishes (or republishes) a manual via the
// /api/superadmin/manuals/[moduleId] PATCH endpoint, this helper
// re-ingests the body into knowledge_documents + knowledge_chunks
// so the home-page assistant can cite it. Drafts (published_at IS
// NULL) are removed from the corpus on the same call.
//
// Idempotency strategy: every manual gets a synthetic content_sha256
// derived from the module_id (`soteria-manual:<module_id>`). The
// unique (tenant_id, content_sha256) constraint on
// knowledge_documents lets us upsert by deleting any prior row with
// that sha and inserting fresh. The trigger-driven cascade on
// knowledge_chunks removes the chunks at the same time.
//
// Tenant scope: manuals are platform-wide content. Documents land
// with tenant_id = NULL so every tenant's RAG sees them. The
// match_knowledge_chunks RPC's RLS already permits NULL-tenant
// documents to every authenticated user.
//
// Failure mode: a sync failure does NOT block the manual update.
// The caller (the PATCH route) catches and logs to Sentry — the
// manual is still saved; only RAG visibility is degraded. A bulk
// sync endpoint (/api/superadmin/manuals/sync-rag) is the operator's
// recovery path.

import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chunkText } from '@/lib/ai/chunker'
import { embed, vectorLiteral, VoyageNotConfiguredError } from '@/lib/ai/embeddings'

const SOURCE_TYPE = 'manual' as const

export interface ManualForSync {
  id:           string
  module_id:    string
  title:        string
  summary:      string | null
  body_md:      string
  /** ISO 8601. Null means draft → the helper removes any prior RAG
   *  row instead of ingesting. */
  published_at: string | null
  /** Bumps on every body change. Stored as the document's
   *  `effective_date` so the assistant's citation logic has a
   *  version-shaped reference point. */
  version:      number
}

export interface SyncOutcome {
  /** What the helper did: ingested fresh, removed (unpublish), or
   *  skipped (already up-to-date / draft / empty). */
  action:        'ingested' | 'removed' | 'skipped'
  /** Set when action === 'ingested'. */
  document_id?:  string
  chunk_count?:  number
  voyage_tokens?: number
}

/** Synthetic content sha so the unique constraint catches re-syncs. */
function manualContentSha(moduleId: string): string {
  // 64 hex chars to match the column shape. Pad if needed; module_id
  // is up to 80 chars per the schema check, plenty for entropy.
  const seed = `soteria-manual:${moduleId}`
  // We don't need a real hash — we just need a stable 64-char string
  // that's unique per module_id. Hex-encoding the seed and padding
  // gets us there without pulling in a hashing dep on this path.
  let hex = ''
  for (let i = 0; i < seed.length; i++) hex += seed.charCodeAt(i).toString(16).padStart(2, '0')
  return hex.padEnd(64, '0').slice(0, 64)
}

/**
 * Re-ingests a manual into the RAG corpus, or removes its prior
 * footprint if the manual is now a draft. Returns a SyncOutcome the
 * caller can log against the PATCH response.
 *
 * Throws on Voyage / DB errors so the caller can decide whether to
 * surface or swallow. The PATCH route swallows; the bulk sync
 * endpoint surfaces a per-row error.
 */
export async function syncManualToRag(manual: ManualForSync): Promise<SyncOutcome> {
  const admin = supabaseAdmin()
  const sha   = manualContentSha(manual.module_id)

  // Drafts: remove any prior row, return.
  if (!manual.published_at) {
    const { error } = await admin
      .from('knowledge_documents')
      .delete()
      .is('tenant_id', null)
      .eq('source_type', SOURCE_TYPE)
      .eq('content_sha256', sha)
    if (error) throw new Error(`Failed to remove draft manual from RAG: ${error.message}`)
    return { action: 'removed' }
  }

  // Empty body: nothing to ingest. Treat as removed for symmetry.
  const bodyText = manual.body_md.trim()
  if (!bodyText) {
    const { error } = await admin
      .from('knowledge_documents')
      .delete()
      .is('tenant_id', null)
      .eq('source_type', SOURCE_TYPE)
      .eq('content_sha256', sha)
    if (error) throw new Error(`Failed to remove empty manual from RAG: ${error.message}`)
    return { action: 'removed' }
  }

  // Chunk + embed.
  const chunks = chunkText({ text: bodyText })
  if (chunks.length === 0) return { action: 'skipped' }

  let embeddings: number[][]
  let voyageTokens = 0
  try {
    const r = await embed({ texts: chunks.map(c => c.text), inputType: 'document' })
    embeddings = r.embeddings
    voyageTokens = r.totalTokens
  } catch (err) {
    if (err instanceof VoyageNotConfiguredError) {
      // No Voyage key means RAG is impossible. Caller decides whether
      // to surface — for the PATCH hook, we let the manual update
      // succeed and log the gap.
      throw err
    }
    throw new Error(`Voyage embedding failed for manual ${manual.module_id}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embedding count mismatch for manual ${manual.module_id}: ${embeddings.length} vs ${chunks.length}`)
  }

  // Replace any prior row for this manual. Cascade on knowledge_chunks
  // (FK ON DELETE CASCADE in migration 105) cleans up the chunks.
  const { error: delErr } = await admin
    .from('knowledge_documents')
    .delete()
    .is('tenant_id', null)
    .eq('source_type', SOURCE_TYPE)
    .eq('content_sha256', sha)
  if (delErr) throw new Error(`Failed to clear prior manual row: ${delErr.message}`)

  const { data: doc, error: docErr } = await admin
    .from('knowledge_documents')
    .insert({
      tenant_id:      null,
      source_type:    SOURCE_TYPE,
      title:          `Soteria User Manual: ${manual.title}`,
      jurisdiction:   null,
      // Use published_at as effective_date so citation rendering can
      // surface "manual updated <date>" in the assistant's reply.
      effective_date: manual.published_at.slice(0, 10),
      source_url:     `/manuals/${manual.module_id}`,
      uploaded_by:    null,
      content_sha256: sha,
      chunk_count:    chunks.length,
    })
    .select('id')
    .maybeSingle()
  if (docErr || !doc) throw new Error(`Failed to insert manual document: ${docErr?.message ?? 'no row returned'}`)

  const rows = chunks.map((c, i) => ({
    document_id: doc.id,
    chunk_index: c.index,
    text:        c.text,
    embedding:   vectorLiteral(embeddings[i]),
    token_count: c.tokenEst,
    metadata: {
      manual_id:  manual.id,
      module_id:  manual.module_id,
      version:    manual.version,
      start_char: c.startChar,
      end_char:   c.endChar,
    },
  }))

  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const { error: chunkErr } = await admin.from('knowledge_chunks').insert(slice)
    if (chunkErr) {
      // Best-effort cleanup so we don't leave a half-ingested document.
      await admin.from('knowledge_documents').delete().eq('id', doc.id)
      throw new Error(`Failed to insert manual chunks: ${chunkErr.message}`)
    }
  }

  return {
    action:        'ingested',
    document_id:   doc.id,
    chunk_count:   chunks.length,
    voyage_tokens: voyageTokens,
  }
}

/**
 * Convenience wrapper for the PATCH hook — swallows errors and
 * captures to Sentry so a sync failure never blocks a manual update.
 */
export async function syncManualToRagSafe(manual: ManualForSync): Promise<SyncOutcome | null> {
  try {
    return await syncManualToRag(manual)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: 'syncManualToRag', module_id: manual.module_id },
    })
    return null
  }
}
