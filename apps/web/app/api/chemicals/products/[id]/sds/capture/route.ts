import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { getAnthropic } from '@/lib/ai/client'
import { parseSdsDocument, parsedConfidenceToNumeric, PARSE_SDS_MODEL } from '@/lib/ai/parseSdsPdf'
import { chemicalSdsStoragePath } from '@soteria/core/chemicals'
import { validateCaptureImages, assembleImagesToPdf } from '@/lib/sdsCapture'

// POST /api/chemicals/products/[id]/sds/capture   { images: string[] }
//
// Capture a PAPER SDS from phone photos: validate the page images, assemble
// them into a PDF, store it as a chemical_sds_documents row (source
// 'photo_capture'), then run the shared parser → review queue. The parse is
// best-effort — if AI is unavailable the captured PDF still stands and the
// worker can parse it later from the product detail.

export const runtime = 'nodejs'
export const maxDuration = 120

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { tenantId, userId } = gate

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  let body: { images?: unknown }
  try { body = (await req.json()) as { images?: unknown } }
  catch { return NextResponse.json({ error: 'Expected JSON body' }, { status: 400 }) }

  const validated = validateCaptureImages(body.images)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const limit = await checkAiRateLimit({ userId, tenantId, surface: 'parse-sds' })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const admin = supabaseAdmin()
    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .select('id')
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (pErr)     return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const pdfBytes = await assembleImagesToPdf(validated.images)
    const fileHash = await sha256Hex(pdfBytes)
    const storagePath = chemicalSdsStoragePath(tenantId, productId, `captured-${Date.now()}.pdf`)

    const { error: upErr } = await admin
      .storage.from('chemical-sds')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', cacheControl: '3600', upsert: false })
    if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })

    const { data: sds, error: insErr } = await admin
      .from('chemical_sds_documents')
      .insert({
        tenant_id:           tenantId,
        product_id:          productId,
        revision_date:       null,
        language:            'en',
        storage_path:        storagePath,
        file_hash:           fileHash,
        file_bytes:          pdfBytes.length,
        mime_type:           'application/pdf',
        source:              'photo_capture',
        parse_review_status: 'approved',
        created_by:          userId,
      })
      .select('*')
      .single()
    if (insErr) {
      await admin.storage.from('chemical-sds').remove([storagePath])
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    // Best-effort parse. Photo OCR is lower-fidelity than a born-digital PDF,
    // so the result still lands in the review queue for a human.
    const base64 = Buffer.from(pdfBytes).toString('base64')
    try {
      const client = await getAnthropic(tenantId)
      const result = await parseSdsDocument(client, base64)
      if (result.ok) {
        const { parsed, inputTokens, outputTokens } = result.value
        const { data: updated } = await admin
          .from('chemical_sds_documents')
          .update({
            parsed_payload:      parsed,
            parse_model:         PARSE_SDS_MODEL,
            parse_confidence:    parsedConfidenceToNumeric(parsed.confidence.overall),
            parse_review_status: 'pending',
          })
          .eq('id', (sds as { id: string }).id)
          .eq('tenant_id', tenantId)
          .select('id, parse_model, parse_confidence, parse_review_status')
          .single()
        await logAiInvocation({
          userId, tenantId, surface: 'parse-sds', model: PARSE_SDS_MODEL, status: 'success',
          inputTokens, outputTokens, context: (sds as { id: string }).id,
        })
        return NextResponse.json({ sds: updated ?? sds, parsed, parsed_ok: true }, { status: 201 })
      }
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: PARSE_SDS_MODEL, status: 'error',
        context: (sds as { id: string }).id,
      })
      return NextResponse.json({ sds, parsed_ok: false }, { status: 201 })
    } catch (parseErr) {
      // AI unavailable — the captured PDF is stored; parsing can be retried.
      Sentry.captureException(parseErr, { tags: { route: '/api/chemicals/sds/capture', stage: 'parse' } })
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: PARSE_SDS_MODEL, status: 'error',
        context: (sds as { id: string }).id,
      })
      return NextResponse.json({ sds, parsed_ok: false }, { status: 201 })
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { route: '/api/chemicals/sds/capture' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
