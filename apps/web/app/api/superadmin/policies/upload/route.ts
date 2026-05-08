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
// Multipart/form-data:
//   file:           the policy document (markdown, text, or PDF)
//   tenant_id:      (optional) UUID. NULL/missing → global document
//                   visible to all tenants. A tenant id pins the doc
//                   to that tenant.
//   source_type:    one of regulation/state_reg/dot/epa/rcra/company_policy.
//                   For superadmin uploads of company docs, default is
//                   'company_policy' (and tenant_id is required); for
//                   regulatory uploads, the operator chooses.
//   title:          short title (≤300 chars). Surfaced as the citation tag.
//   jurisdiction:   (optional) e.g. "CA" for state_reg. Free text.
//   effective_date: (optional) ISO date.
//   source_url:     (optional) canonical source link (eCFR, intranet).
//
// Pipeline: extract text → chunk → embed (Voyage) → insert document +
// chunks. Idempotent on (tenant_id, sha256): a duplicate upload returns
// the existing document instead of erroring.

const VALID_SOURCE_TYPES = new Set([
  'regulation', 'state_reg', 'dot', 'epa', 'rcra', 'company_policy',
])

// Vercel App Router config: bump the body size limit + node runtime
// so PDF uploads up to 25MB go through.
export const runtime     = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data body.' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A "file" field is required.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB cap.` }, { status: 413 })
  }
  const mime = (file.type || 'application/octet-stream') as ExtractMime
  if (!SUPPORTED_MIMES.includes(mime)) {
    return NextResponse.json(
      { error: `Unsupported MIME ${mime}. Supported: ${SUPPORTED_MIMES.join(', ')}.` },
      { status: 415 },
    )
  }

  const sourceType = String(form.get('source_type') ?? 'company_policy')
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: `Invalid source_type: ${sourceType}.` }, { status: 400 })
  }
  const title = String(form.get('title') ?? file.name).trim().slice(0, 300)
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })

  const rawTenantId = form.get('tenant_id')
  const tenantId = typeof rawTenantId === 'string' && /^[0-9a-f-]{36}$/i.test(rawTenantId.trim())
    ? rawTenantId.trim()
    : null
  if (sourceType === 'company_policy' && !tenantId) {
    return NextResponse.json(
      { error: 'tenant_id is required for company_policy uploads.' },
      { status: 400 },
    )
  }

  const jurisdiction   = formStr(form, 'jurisdiction')
  const sourceUrl      = formStr(form, 'source_url')
  const effectiveDate  = formStr(form, 'effective_date')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha   = await sha256Hex(bytes)

  const admin = supabaseAdmin()

  // De-dupe: if the same tenant has already uploaded this exact file,
  // return the existing record. Operators routinely paste the same
  // master policy across tenants — we'd rather they not pay tokens
  // for a redundant ingestion.
  const dedupeQuery = admin
    .from('knowledge_documents')
    .select('id, chunk_count, title, tenant_id')
    .eq('content_sha256', sha)
  if (tenantId) dedupeQuery.eq('tenant_id', tenantId)
  else          dedupeQuery.is('tenant_id', null)
  const { data: existing } = await dedupeQuery.maybeSingle()
  if (existing) {
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
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    const mapped = aiErrorToResponse(err, 'parse-sds')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/superadmin/policies/upload' } })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }
  if (extractUsage) {
    await logAiInvocation({
      userId:           gate.userId,
      tenantId,
      surface:          'parse-sds', // share the surface — no separate budget for policy ingest
      model:            SONNET,
      status:           'success',
      inputTokens:      extractUsage.inputTokens,
      outputTokens:     extractUsage.outputTokens,
      cacheReadTokens:  extractUsage.cacheReadTokens,
      context:          `policy-extract:${title.slice(0, 50)}`,
    })
  }
  if (!text || text === 'SCAN_NOT_OCRED') {
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

  // Insert the document, then the chunks. Both pass through the
  // service-role client (RLS bypass) but the gate has already
  // confirmed superadmin status.
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
    // pgvector accepts the literal string `'[1.2,3.4,...]'` and casts
    // it to vector(1024) on insert. supabase-js sends the value as a
    // string; PostgREST forwards it; Postgres parses it. Cleaner than
    // an RPC just for this.
    embedding:   vectorLiteral(embeddings[i]),
    token_count: c.tokenEst,
    metadata: {
      start_char: c.startChar,
      end_char:   c.endChar,
    },
  }))

  // Insert in batches of 200 to keep the request payload reasonable.
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const { error: chunkErr } = await admin.from('knowledge_chunks').insert(slice)
    if (chunkErr) {
      // Roll back the document so we don't leave a half-ingested row.
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

  return NextResponse.json({
    ok: true,
    document_id:   doc.id,
    chunk_count:   chunks.length,
    voyage_tokens: voyageTokens,
    duplicate:     false,
  })
}

function formStr(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}
