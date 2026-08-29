import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { parseSdsDocument, parsedConfidenceToNumeric, nullifyEmptyStrings, PARSE_SDS_MODEL } from '@/lib/ai/parseSdsPdf'
import { type ParsedSdsPayload } from '@soteria/core/chemicals'
import { parseSdsViaFallback, sdsFallbackConfigured, isAiUnavailable } from '@/lib/ai/sdsFallback'

// POST /api/chemicals/products/[id]/sds/[sdsId]/parse
//
// Reads the SDS PDF for {sdsId} from the chemical-sds bucket, sends it
// to Claude Sonnet (via the shared parseSdsDocument helper), and writes
// the parsed payload back to chemical_sds_documents.parsed_payload (along
// with model, confidence, and parse_review_status='pending'). When Claude
// is unavailable (no key / usage cap / 5xx) a deterministic fallback parser
// stands in if it's configured.
//
// The endpoint never modifies the chemical_products row directly — that
// happens via the sibling /apply endpoint after a human approves the
// proposed fields. This keeps "what the AI suggested" and "what the
// safety lead approved" cleanly separated for audit.

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PDF_BYTES = 25_000_000
// The deterministic fallback parser's model id (services/sds-parser). Stored
// in parse_model so the review queue / audit can tell a heuristic parse apart.
const SDS_FALLBACK_MODEL = 'python-sds-parser@1'

interface Ctx { params: Promise<{ id: string; sdsId: string }> }

// Persist a parsed payload as a pending review + log the invocation, then
// return the success response. Shared by the AI path and the deterministic
// fallback so both write identical columns. The fallback flag tells the client
// which parser produced the result (the deterministic one caps confidence at
// "medium", so the review queue surfaces it for a human either way).
async function persistParse(
  admin: ReturnType<typeof supabaseAdmin>,
  ids: { sdsId: string; tenantId: string; userId: string },
  parsed: ParsedSdsPayload,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | null,
): Promise<NextResponse> {
  const { sdsId, tenantId, userId } = ids
  if (!parsed.product_name || !parsed.confidence) {
    await logAiInvocation({ userId, tenantId, surface: 'parse-sds', model, status: 'error', context: sdsId })
    return NextResponse.json({ error: 'Parser returned an incomplete payload.' }, { status: 502 })
  }

  const numericConfidence = parsedConfidenceToNumeric(parsed.confidence.overall)

  const { data: updated, error: upErr } = await admin
    .from('chemical_sds_documents')
    .update({
      parsed_payload:      parsed,
      parse_model:         model,
      parse_confidence:    numericConfidence,
      parse_review_status: 'pending',
    })
    .eq('id',        sdsId)
    .eq('tenant_id', tenantId)
    .select('id, parse_model, parse_confidence, parse_review_status')
    .single()
  if (upErr) {
    await logAiInvocation({ userId, tenantId, surface: 'parse-sds', model, status: 'error', context: sdsId })
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  await logAiInvocation({
    userId, tenantId, surface: 'parse-sds', model, status: 'success',
    inputTokens:  usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    context:      sdsId,
  })

  return NextResponse.json({ sds: updated, parsed, fallback: model === SDS_FALLBACK_MODEL }, { status: 200 })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const tenantId = gate.tenantId
  const userId   = gate.userId

  const { id: productId, sdsId } = await ctx.params
  if (!UUID_RE.test(productId) || !UUID_RE.test(sdsId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const limit = await checkAiRateLimit({
    userId, tenantId, surface: 'parse-sds',
  })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const admin = supabaseAdmin()

    const { data: sds, error: sErr } = await admin
      .from('chemical_sds_documents')
      .select('id, storage_path, file_bytes, product_id, tenant_id')
      .eq('id', sdsId)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sds) return NextResponse.json({ error: 'SDS not found' }, { status: 404 })

    if (sds.file_bytes && sds.file_bytes > MAX_PDF_BYTES) {
      return NextResponse.json({
        error: `SDS PDF too large to parse (${(sds.file_bytes / 1_000_000).toFixed(1)} MB > ${MAX_PDF_BYTES / 1_000_000} MB)`,
      }, { status: 413 })
    }

    const { data: blob, error: dlErr } = await admin
      .storage
      .from('chemical-sds')
      .download(sds.storage_path)
    if (dlErr || !blob) {
      return NextResponse.json({ error: dlErr?.message ?? 'Failed to download SDS' }, { status: 500 })
    }

    const buf = Buffer.from(await blob.arrayBuffer())
    const base64 = buf.toString('base64')

    let client: Anthropic
    try {
      client = await getAnthropic(tenantId)
    } catch (err) {
      // No / malformed AI key — use the deterministic parser if it's wired up.
      const fb = sdsFallbackConfigured() ? await parseSdsViaFallback(buf) : null
      if (fb) return await persistParse(admin, { sdsId, tenantId, userId }, nullifyEmptyStrings(fb), SDS_FALLBACK_MODEL, null)
      const mapped = aiErrorToResponse(err, 'parse-sds')
      Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/chemicals/products/sds/parse' } })
      return NextResponse.json(mapped.body, { status: mapped.status })
    }

    let result: Awaited<ReturnType<typeof parseSdsDocument>>
    try {
      result = await parseSdsDocument(client, base64)
    } catch (err) {
      // AI unavailable (usage cap / rate limit / 5xx) — try the deterministic
      // parser before surfacing the error. Other errors fall through to the
      // outer handler unchanged.
      if (isAiUnavailable(err) && sdsFallbackConfigured()) {
        const fb = await parseSdsViaFallback(buf)
        if (fb) return await persistParse(admin, { sdsId, tenantId, userId }, nullifyEmptyStrings(fb), SDS_FALLBACK_MODEL, null)
      }
      throw err
    }

    if (!result.ok) {
      if (result.failure === 'no_output') {
        console.error('[parse-sds] no text block in response', {
          stop_reason:   result.stopReason,
          content_types: result.contentTypes,
        })
      }
      await logAiInvocation({
        userId, tenantId, surface: 'parse-sds', model: PARSE_SDS_MODEL, status: 'error',
        context: sdsId,
      })
      const message =
        result.failure === 'invalid_json' ? 'AI returned invalid JSON.'
        : result.failure === 'incomplete' ? 'AI returned an incomplete payload.'
        : 'AI returned no usable output.'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    const { parsed, inputTokens, outputTokens } = result.value
    return await persistParse(
      admin, { sdsId, tenantId, userId }, parsed, PARSE_SDS_MODEL,
      { input_tokens: inputTokens, output_tokens: outputTokens },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/chemicals/sds/parse' } })
    console.error('[parse-sds]', err)
    await logAiInvocation({
      userId, tenantId, surface: 'parse-sds', model: PARSE_SDS_MODEL, status: 'error',
      context: sdsId,
    })
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'AI is rate-limited. Retry in a minute.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json({ error: 'Parse failed.' }, { status: 500 })
  }
}
