import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chunkText } from '@/lib/ai/chunker'
import { embed, vectorLiteral, VoyageNotConfiguredError } from '@/lib/ai/embeddings'
import {
  extractPolicyText,
  sha256Hex,
  SUPPORTED_MIMES,
  MAX_BYTES,
  UnsupportedMimeError,
  type ExtractMime,
} from '@/lib/ai/policyExtract'
import { aiErrorToResponse } from '@/lib/ai/client'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { SONNET } from '@/lib/ai/models'

// Shared knowledge-base ingestion pipeline. Both the superadmin route
// (/api/superadmin/policies/upload — global regs + any tenant's policy) and
// the tenant self-service route (/api/admin/policies — a tenant's own
// company policies) call this with already-resolved, trusted parameters.
//
// The caller owns AUTH and PARAMETER POLICY (which source_type is allowed,
// which tenant the document is scoped to, where the staged file may live).
// This function owns the PIPELINE: download the staged file → extract text →
// chunk → embed (Voyage) → insert document + chunks → delete the staged
// object. Idempotent on (tenant_id, content_sha256): a duplicate returns the
// existing record. Returns an HTTP-shaped { status, body } the route forwards
// verbatim, so error semantics stay identical across both entry points.

const STAGING_BUCKET = 'policy-uploads'

// Staged uploads for a tenant's self-service ingest live under a per-tenant
// prefix so the server can prove a path belongs to the calling tenant before
// it downloads + ingests it. The superadmin flow uses flat paths and does not
// go through this guard.
export function tenantStagingPrefix(tenantId: string): string {
  return `tenant/${tenantId}/`
}

// True only for a path of the exact shape `tenant/<tenantId>/<filename>` with
// a single safe filename segment. Rejects sub-paths, traversal, and any path
// scoped to a different tenant — the load-bearing check that stops a tenant
// admin from ingesting another tenant's (or an arbitrary) staged object.
export function isWithinTenantStaging(path: string, tenantId: string): boolean {
  const m = /^tenant\/([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/i.exec(path)
  return !!m && m[1].toLowerCase() === tenantId.toLowerCase()
}

export interface IngestPolicyParams {
  /** Path inside the policy-uploads bucket where the browser staged the file. */
  storagePath: string
  /** Document scope. null = global (visible to every tenant). */
  tenantId: string | null
  /** Already validated against the caller's allowed set. */
  sourceType: string
  title: string
  jurisdiction?: string
  effectiveDate?: string
  sourceUrl?: string
  /** MIME hint; falls back to the stored object's content-type. */
  mime?: string
  /** Uploading user, recorded on the document + AI-spend log. */
  userId: string
  /** Route identifier for Sentry tags. */
  route: string
}

export interface IngestOutcome {
  status: number
  body: Record<string, unknown>
}

export async function ingestPolicyDocument(p: IngestPolicyParams): Promise<IngestOutcome> {
  const admin = supabaseAdmin()
  const title = p.title.trim().slice(0, 300)
  const jurisdiction  = (p.jurisdiction  ?? '').trim()
  const sourceUrl     = (p.sourceUrl     ?? '').trim()
  const effectiveDate = (p.effectiveDate ?? '').trim()

  // Pull the bytes out of Storage. The bucket is private + RLS-locked;
  // service-role bypasses RLS so we read directly. 404 on a missing path.
  const { data: blob, error: dlErr } = await admin.storage.from(STAGING_BUCKET).download(p.storagePath)
  if (dlErr || !blob) {
    return { status: 404, body: { error: `Could not load the staged upload: ${dlErr?.message ?? 'not found'}` } }
  }

  const arrayBuf = await blob.arrayBuffer()
  if (arrayBuf.byteLength > MAX_BYTES) {
    void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
    return { status: 413, body: { error: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB cap.` } }
  }
  const bytes = new Uint8Array(arrayBuf)

  // MIME priority: explicit hint → Storage metadata → reject. The bucket
  // allowlist already gates uploads, but we re-check so config drift can't
  // silently let the wrong type through.
  const mime = (p.mime ?? blob.type ?? '').trim() as ExtractMime
  if (!mime || !SUPPORTED_MIMES.includes(mime)) {
    void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
    return {
      status: 415,
      body: { error: `Unsupported MIME ${mime || '(unknown)'}. Supported: ${SUPPORTED_MIMES.join(', ')}.` },
    }
  }

  const sha = await sha256Hex(bytes)

  // De-dupe: same scope + same content → return existing.
  const dedupeQuery = admin
    .from('knowledge_documents')
    .select('id, chunk_count, title, tenant_id')
    .eq('content_sha256', sha)
  if (p.tenantId) dedupeQuery.eq('tenant_id', p.tenantId)
  else            dedupeQuery.is('tenant_id', null)
  const { data: existing } = await dedupeQuery.maybeSingle()
  if (existing) {
    void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
    return {
      status: 200,
      body: {
        ok: true,
        document_id: existing.id,
        chunk_count: existing.chunk_count,
        duplicate:   true,
        message:     'A document with this content was already uploaded; returning the existing record.',
      },
    }
  }

  // Extract text. PDF extraction goes through Claude — log the spend.
  let text: string
  let extractUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | undefined
  try {
    const extracted = await extractPolicyText({ bytes, mime, tenantId: p.tenantId })
    text = extracted.text.trim()
    extractUsage = extracted.usage
  } catch (err) {
    if (err instanceof UnsupportedMimeError) {
      void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
      return { status: 415, body: { error: err.message } }
    }
    const mapped = aiErrorToResponse(err, 'parse-sds')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: p.route } })
    void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
    return { status: mapped.status, body: mapped.body as Record<string, unknown> }
  }
  if (extractUsage) {
    await logAiInvocation({
      userId:          p.userId,
      tenantId:        p.tenantId,
      surface:         'parse-sds',
      model:           SONNET,
      status:          'success',
      inputTokens:     extractUsage.inputTokens,
      outputTokens:    extractUsage.outputTokens,
      cacheReadTokens: extractUsage.cacheReadTokens,
      context:         `policy-extract:${title.slice(0, 50)}`,
    })
  }
  if (!text || text === 'SCAN_NOT_OCRED') {
    void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
    return {
      status: 422,
      body: {
        error: text === 'SCAN_NOT_OCRED'
          ? 'This PDF appears to be a scanned image without OCR. Run it through OCR first, then re-upload.'
          : 'No text could be extracted from this file.',
      },
    }
  }

  // Chunk + embed.
  const chunks = chunkText({ text })
  if (chunks.length === 0) {
    void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])
    return { status: 422, body: { error: 'Document text was too short to chunk.' } }
  }

  let embeddings: number[][]
  let voyageTokens = 0
  try {
    const r = await embed({ texts: chunks.map(c => c.text), inputType: 'document' })
    embeddings = r.embeddings
    voyageTokens = r.totalTokens
  } catch (err) {
    if (err instanceof VoyageNotConfiguredError) {
      return {
        status: 503,
        body: { error: 'VOYAGE_API_KEY is not configured. Add it to the deployment env to enable policy ingest.' },
      }
    }
    Sentry.captureException(err, { tags: { source: 'policy-ingest.embed', route: p.route } })
    return { status: 502, body: { error: 'Embedding service is unavailable. Try again shortly.' } }
  }
  if (embeddings.length !== chunks.length) {
    return {
      status: 502,
      body: { error: `Embedding count mismatch: ${embeddings.length} vs ${chunks.length} chunks.` },
    }
  }

  const { data: doc, error: docErr } = await admin
    .from('knowledge_documents')
    .insert({
      tenant_id:      p.tenantId,
      source_type:    p.sourceType,
      title,
      jurisdiction:   jurisdiction || null,
      effective_date: effectiveDate || null,
      source_url:     sourceUrl    || null,
      uploaded_by:    p.userId,
      content_sha256: sha,
      chunk_count:    chunks.length,
    })
    .select('id')
    .maybeSingle()
  if (docErr || !doc) {
    Sentry.captureException(docErr, { tags: { source: 'policy-ingest.insert-doc', route: p.route } })
    return { status: 500, body: { error: docErr?.message ?? 'Failed to insert document.' } }
  }

  const rows = chunks.map((c, i) => ({
    document_id: doc.id,
    chunk_index: c.index,
    text:        c.text,
    embedding:   vectorLiteral(embeddings[i]),
    token_count: c.tokenEst,
    metadata: {
      start_char: c.startChar,
      end_char:   c.endChar,
    },
  }))

  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const { error: chunkErr } = await admin.from('knowledge_chunks').insert(slice)
    if (chunkErr) {
      await admin.from('knowledge_documents').delete().eq('id', doc.id)
      Sentry.captureException(chunkErr, {
        tags: { source: 'policy-ingest.insert-chunks', document_id: doc.id, batch: String(i), route: p.route },
      })
      return { status: 500, body: { error: `Failed to insert chunks: ${chunkErr.message}` } }
    }
  }

  // Ingestion succeeded — remove the staged file. Best-effort; a cleanup
  // hiccup leaves the object in the bucket but the document is good.
  void admin.storage.from(STAGING_BUCKET).remove([p.storagePath])

  return {
    status: 200,
    body: { ok: true, document_id: doc.id, chunk_count: chunks.length, voyage_tokens: voyageTokens, duplicate: false },
  }
}
