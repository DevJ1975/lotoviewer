import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
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

// POST /api/superadmin/policies/upload
//
// Body (application/json):
//   storage_path:   path inside the policy-uploads Supabase Storage
//                   bucket where the browser put the file. The route
//                   downloads the bytes server-side and processes them.
//                   We use storage staging because Vercel caps direct
//                   request bodies at 4.5MB, which is smaller than the
//                   25MB limit the route + bucket support.
//   tenant_id:      (optional) UUID. NULL/missing → global document
//                   visible to all tenants.
//   source_type:    one of regulation/state_reg/dot/epa/rcra/company_policy.
//   title:          short title (≤300 chars).
//   jurisdiction:   (optional) e.g. "CA" for state_reg.
//   effective_date: (optional) ISO date.
//   source_url:     (optional) canonical source link.
//   mime:           (optional) MIME hint when the bucket-stored file
//                   doesn't carry one (rare). Falls back to the storage
//                   metadata's content_type otherwise.
//
// Pipeline: download from storage → extract text → chunk → embed
// (Voyage) → insert document + chunks → delete the staged storage
// object. Idempotent on (tenant_id, sha256) — a duplicate upload
// returns the existing document.

const VALID_SOURCE_TYPES = new Set([
  'regulation', 'state_reg', 'dot', 'epa', 'rcra', 'company_policy',
])

const STAGING_BUCKET = 'policy-uploads'

export const runtime     = 'nodejs'
export const maxDuration = 300

interface RequestBody {
  storage_path?:   string
  tenant_id?:      string | null
  source_type?:    string
  title?:          string
  jurisdiction?:   string
  effective_date?: string
  source_url?:     string
  mime?:           string
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: RequestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected application/json body.' }, { status: 400 }) }

  const storagePath = (body.storage_path ?? '').trim()
  if (!storagePath) {
    return NextResponse.json(
      { error: 'storage_path is required. Upload the file to the policy-uploads bucket first.' },
      { status: 400 },
    )
  }

  const sourceType = String(body.source_type ?? 'company_policy')
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: `Invalid source_type: ${sourceType}.` }, { status: 400 })
  }

  const title = (body.title ?? '').trim().slice(0, 300)
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })

  const tenantId = typeof body.tenant_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.tenant_id.trim())
    ? body.tenant_id.trim()
    : null
  if (sourceType === 'company_policy' && !tenantId) {
    return NextResponse.json(
      { error: 'tenant_id is required for company_policy uploads.' },
      { status: 400 },
    )
  }

  const jurisdiction  = (body.jurisdiction  ?? '').trim()
  const sourceUrl     = (body.source_url    ?? '').trim()
  const effectiveDate = (body.effective_date ?? '').trim()

  const admin = supabaseAdmin()

  // Pull the bytes out of Supabase Storage. The bucket is private +
  // RLS-locked; service-role bypasses RLS so we read directly. If the
  // path doesn't resolve we 404 (rather than the SDK's generic error).
  const { data: blob, error: dlErr } = await admin.storage.from(STAGING_BUCKET).download(storagePath)
  if (dlErr || !blob) {
    return NextResponse.json(
      { error: `Could not load the staged upload: ${dlErr?.message ?? 'not found'}` },
      { status: 404 },
    )
  }

  const arrayBuf = await blob.arrayBuffer()
  if (arrayBuf.byteLength > MAX_BYTES) {
    // Clean up the stale upload so it doesn't sit in the bucket forever.
    void admin.storage.from(STAGING_BUCKET).remove([storagePath])
    return NextResponse.json(
      { error: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB cap.` },
      { status: 413 },
    )
  }
  const bytes = new Uint8Array(arrayBuf)

  // MIME resolution priority: explicit body field → blob.type from
  // Supabase Storage metadata → reject. The bucket's allowed_mime_types
  // already enforces the allowlist at upload time, but we re-check here
  // so a future config drift doesn't silently accept the wrong type.
  const mime = (body.mime ?? blob.type ?? '').trim() as ExtractMime
  if (!mime || !SUPPORTED_MIMES.includes(mime)) {
    void admin.storage.from(STAGING_BUCKET).remove([storagePath])
    return NextResponse.json(
      { error: `Unsupported MIME ${mime || '(unknown)'}. Supported: ${SUPPORTED_MIMES.join(', ')}.` },
      { status: 415 },
    )
  }

  const sha = await sha256Hex(bytes)

  // De-dupe: same tenant + same content → return existing.
  const dedupeQuery = admin
    .from('knowledge_documents')
    .select('id, chunk_count, title, tenant_id')
    .eq('content_sha256', sha)
  if (tenantId) dedupeQuery.eq('tenant_id', tenantId)
  else          dedupeQuery.is('tenant_id', null)
  const { data: existing } = await dedupeQuery.maybeSingle()
  if (existing) {
    void admin.storage.from(STAGING_BUCKET).remove([storagePath])
    return NextResponse.json({
      ok: true,
      document_id: existing.id,
      chunk_count: existing.chunk_count,
      duplicate:   true,
      message:     'A document with this content was already uploaded; returning the existing record.',
    })
  }

  // Extract text. PDF extraction goes through Claude — log the spend.
  let text: string
  let extractUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | undefined
  try {
    const extracted = await extractPolicyText({ bytes, mime, tenantId })
    text = extracted.text.trim()
    extractUsage = extracted.usage
  } catch (err) {
    if (err instanceof UnsupportedMimeError) {
      void admin.storage.from(STAGING_BUCKET).remove([storagePath])
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    const mapped = aiErrorToResponse(err, 'parse-sds')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/superadmin/policies/upload' } })
    void admin.storage.from(STAGING_BUCKET).remove([storagePath])
    return NextResponse.json(mapped.body, { status: mapped.status })
  }
  if (extractUsage) {
    await logAiInvocation({
      userId:           gate.userId,
      tenantId,
      surface:          'parse-sds',
      model:            SONNET,
      status:           'success',
      inputTokens:      extractUsage.inputTokens,
      outputTokens:     extractUsage.outputTokens,
      cacheReadTokens:  extractUsage.cacheReadTokens,
      context:          `policy-extract:${title.slice(0, 50)}`,
    })
  }
  if (!text || text === 'SCAN_NOT_OCRED') {
    void admin.storage.from(STAGING_BUCKET).remove([storagePath])
    return NextResponse.json(
      { error: text === 'SCAN_NOT_OCRED'
        ? 'This PDF appears to be a scanned image without OCR. Run it through OCR first, then re-upload.'
        : 'No text could be extracted from this file.' },
      { status: 422 },
    )
  }

  // Chunk + embed.
  const chunks = chunkText({ text })
  if (chunks.length === 0) {
    void admin.storage.from(STAGING_BUCKET).remove([storagePath])
    return NextResponse.json({ error: 'Document text was too short to chunk.' }, { status: 422 })
  }

  let embeddings: number[][]
  let voyageTokens = 0
  try {
    const r = await embed({ texts: chunks.map(c => c.text), inputType: 'document' })
    embeddings = r.embeddings
    voyageTokens = r.totalTokens
  } catch (err) {
    if (err instanceof VoyageNotConfiguredError) {
      return NextResponse.json(
        { error: 'VOYAGE_API_KEY is not configured. Add it to the deployment env to enable policy ingest.' },
        { status: 503 },
      )
    }
    Sentry.captureException(err, { tags: { source: 'policies-upload.embed' } })
    return NextResponse.json({ error: 'Embedding service is unavailable. Try again shortly.' }, { status: 502 })
  }
  if (embeddings.length !== chunks.length) {
    return NextResponse.json(
      { error: `Embedding count mismatch: ${embeddings.length} vs ${chunks.length} chunks.` },
      { status: 502 },
    )
  }

  const { data: doc, error: docErr } = await admin
    .from('knowledge_documents')
    .insert({
      tenant_id:      tenantId,
      source_type:    sourceType,
      title,
      jurisdiction:   jurisdiction || null,
      effective_date: effectiveDate || null,
      source_url:     sourceUrl    || null,
      uploaded_by:    gate.userId,
      content_sha256: sha,
      chunk_count:    chunks.length,
    })
    .select('id')
    .maybeSingle()
  if (docErr || !doc) {
    Sentry.captureException(docErr, { tags: { source: 'policies-upload.insert-doc' } })
    return NextResponse.json({ error: docErr?.message ?? 'Failed to insert document.' }, { status: 500 })
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
        tags: { source: 'policies-upload.insert-chunks', document_id: doc.id, batch: String(i) },
      })
      return NextResponse.json(
        { error: `Failed to insert chunks: ${chunkErr.message}` },
        { status: 500 },
      )
    }
  }

  // Ingestion succeeded — remove the staged file. Best-effort: we
  // don't fail the response if cleanup hiccups; the file will sit in
  // the bucket but the document is good.
  void admin.storage.from(STAGING_BUCKET).remove([storagePath])

  return NextResponse.json({
    ok: true,
    document_id:   doc.id,
    chunk_count:   chunks.length,
    voyage_tokens: voyageTokens,
    duplicate:     false,
  })
}
