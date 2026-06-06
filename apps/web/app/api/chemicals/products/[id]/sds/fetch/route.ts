import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chemicalSdsStoragePath } from '@soteria/core/chemicals'
import { verifyPDF } from '@/lib/security/magicBytes'
import { fetchSdsPdf, type FetchOutcome } from '@/lib/chemicalSdsFetch'

// POST /api/chemicals/products/[id]/sds/fetch   { "url": "https://..." }
//
// Downloads a human-confirmed SDS candidate URL (from /discover) and persists
// it as a chemical_sds_documents row with source='ai_fetch'. Mirrors the
// upload route's persistence (dedupe by file_hash, upload to chemical-sds,
// insert) with two differences:
//   - bytes come from fetchSdsPdf({ allowAnyHost: true }) — the host allowlist
//     is relaxed only because a person already chose this URL; every other
//     SSRF guard (https, private-IP, size/timeout, content-type) still applies.
//   - we DON'T flip active_sds_id. The fetched PDF is unparsed and unreviewed;
//     it becomes active only after the user runs Parse and approves it. We do
//     record sds_source_url so the drift monitor can watch it going forward.
//
// parse_review_status is 'approved' here only in the sense of "no AI parse to
// review yet" (same as a manual upload); it flips to 'pending' when the user
// clicks Parse.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

function statusForOutcome(o: FetchOutcome): number {
  switch (o) {
    case 'invalid_url':
    case 'invalid_scheme':
    case 'private_address_blocked':
    case 'allowlist_blocked':   return 400
    case 'wrong_content_type':  return 422
    case 'too_large':           return 413
    default:                    return 502   // timeout / http_error / network_error
  }
}

function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return last || 'sds.pdf'
  } catch {
    return 'sds.pdf'
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { tenantId, userId } = gate

  const { id: productId } = await ctx.params
  if (!UUID_RE.test(productId)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  let body: { url?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected JSON body' }, { status: 400 }) }

  const url = typeof body.url === 'string' ? body.url.trim() : ''
  let parsedUrl: URL
  try { parsedUrl = new URL(url) }
  catch { return NextResponse.json({ error: 'A valid url is required' }, { status: 400 }) }
  if (parsedUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'SDS URL must be https' }, { status: 400 })
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

    const result = await fetchSdsPdf(url, { allowAnyHost: true })
    if (result.outcome !== 'ok' || !result.bytes || !result.sha256) {
      return NextResponse.json(
        { error: `Could not fetch the SDS (${result.outcome})${result.detail ? `: ${result.detail}` : ''}`, outcome: result.outcome },
        { status: statusForOutcome(result.outcome) },
      )
    }
    if (!verifyPDF(result.bytes)) {
      return NextResponse.json({ error: 'Fetched content is not a valid PDF' }, { status: 422 })
    }

    const fileHash = result.sha256
    const { data: existing } = await admin
      .from('chemical_sds_documents')
      .select('*')
      .eq('product_id', productId)
      .eq('tenant_id', tenantId)
      .eq('file_hash', fileHash)
      .maybeSingle()
    if (existing) {
      // Already on file — still record the source URL for drift checks.
      await admin.from('chemical_products')
        .update({ sds_source_url: result.finalUrl ?? url, updated_by: userId })
        .eq('id', productId).eq('tenant_id', tenantId)
      return NextResponse.json({ sds: existing, deduped: true }, { status: 200 })
    }

    let storagePath = chemicalSdsStoragePath(tenantId, productId, filenameFromUrl(url))
    const { error: upErr } = await admin
      .storage.from('chemical-sds')
      .upload(storagePath, result.bytes, { contentType: 'application/pdf', cacheControl: '3600', upsert: false })
    if (upErr) {
      if (/already exists|duplicate/i.test(upErr.message)) {
        const suffixed = storagePath.replace(/(\.pdf)?$/i, `-${Date.now()}.pdf`)
        const { error: retryErr } = await admin
          .storage.from('chemical-sds')
          .upload(suffixed, result.bytes, { contentType: 'application/pdf', upsert: false })
        if (retryErr) return NextResponse.json({ error: `Upload failed: ${retryErr.message}` }, { status: 500 })
        storagePath = suffixed
      } else {
        return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 })
      }
    }

    const { data: sds, error: insErr } = await admin
      .from('chemical_sds_documents')
      .insert({
        tenant_id:           tenantId,
        product_id:          productId,
        revision_date:       null,
        language:            'en',
        storage_path:        storagePath,
        file_hash:           fileHash,
        file_bytes:          result.bytes.length,
        mime_type:           'application/pdf',
        source:              'ai_fetch',
        parse_review_status: 'approved',
        created_by:          userId,
      })
      .select('*')
      .single()
    if (insErr) {
      await admin.storage.from('chemical-sds').remove([storagePath])
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    await admin.from('chemical_products')
      .update({ sds_source_url: result.finalUrl ?? url, updated_by: userId })
      .eq('id', productId).eq('tenant_id', tenantId)

    return NextResponse.json({ sds }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
