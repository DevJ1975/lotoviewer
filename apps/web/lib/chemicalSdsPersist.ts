import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { chemicalSdsStoragePath } from '@soteria/core/chemicals'
import { verifyPDF } from '@/lib/security/magicBytes'
import { fetchSdsPdf, type FetchOutcome } from '@/lib/chemicalSdsFetch'

// Shared persistence for an SDS PDF fetched from a remote URL.
//
// Extracted from the /sds/fetch route so the "adopt from library" flow and
// the existing fetch route share one implementation: download via the
// SSRF-guarded fetcher, verify magic bytes, dedupe by sha256, upload to the
// tenant-scoped chemical-sds bucket, and insert a chemical_sds_documents row
// (source='ai_fetch'). The row is left unparsed and unreviewed — the caller
// runs Parse next, which is what flips parse_review_status to 'pending'.
//
// This returns a plain result (never a NextResponse) so HTTP and non-HTTP
// callers can map outcomes however they need; statusForPersistOutcome() does
// the route-level HTTP mapping that both fetch-style callers reuse.

// chemical_sds_documents columns (migration 089). supabaseAdmin() is untyped,
// so we cast its select('*') rows to this — callers get a real shape instead
// of `any` leaking out of the lib.
export interface ChemicalSdsDocumentRow {
  id:                  string
  tenant_id:           string
  product_id:          string
  revision_date:       string | null
  language:            string
  storage_path:        string
  file_hash:           string | null
  file_bytes:          number | null
  mime_type:           string
  parsed_payload:      unknown | null
  parse_model:         string | null
  parse_confidence:    number | null
  parse_review_status: string
  source:              string
  superseded_by:       string | null
  superseded_at:       string | null
  superseded_reason:   string | null
  created_at:          string
  created_by:          string | null
}

export type PersistOutcome =
  | FetchOutcome     // fetch-stage failures surfaced by fetchSdsPdf
  | 'not_pdf'        // bytes downloaded but failed the PDF magic-byte check
  | 'upload_failed'
  | 'insert_failed'

export interface PersistFetchedSdsParams {
  tenantId:  string
  productId: string
  url:       string
  userId:    string
}

export type PersistFetchedSdsResult =
  | { ok: true;  sds: ChemicalSdsDocumentRow; deduped: boolean; finalUrl: string }
  | { ok: false; outcome: PersistOutcome; detail?: string }

// HTTP status for a persist outcome. The 4xx codes mirror the fetch route's
// original statusForOutcome; not_pdf is 422 (we fetched bytes but they aren't
// a PDF), upload/insert failures are 500 (our storage/DB, not the source).
export function statusForPersistOutcome(o: PersistOutcome): number {
  switch (o) {
    case 'invalid_url':
    case 'invalid_scheme':
    case 'private_address_blocked':
    case 'allowlist_blocked':   return 400
    case 'wrong_content_type':
    case 'not_pdf':             return 422
    case 'too_large':           return 413
    case 'upload_failed':
    case 'insert_failed':       return 500
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

/**
 * Fetch an SDS PDF from `url` and persist it for {tenantId, productId}.
 *
 * Assumes the caller has already verified the product exists and belongs to
 * the tenant — this function only touches the SDS document + the product's
 * sds_source_url. allowAnyHost is true because the URL is human- or
 * library-confirmed; every other SSRF guard in fetchSdsPdf still applies.
 */
export async function persistFetchedSds(
  params: PersistFetchedSdsParams,
): Promise<PersistFetchedSdsResult> {
  const { tenantId, productId, url, userId } = params
  const admin = supabaseAdmin()

  const result = await fetchSdsPdf(url, { allowAnyHost: true })
  if (result.outcome !== 'ok' || !result.bytes || !result.sha256) {
    return { ok: false, outcome: result.outcome, detail: result.detail }
  }
  if (!verifyPDF(result.bytes)) {
    return { ok: false, outcome: 'not_pdf' }
  }

  const fileHash = result.sha256
  const finalUrl = result.finalUrl ?? url

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
      .update({ sds_source_url: finalUrl, updated_by: userId })
      .eq('id', productId).eq('tenant_id', tenantId)
    return { ok: true, sds: existing as ChemicalSdsDocumentRow, deduped: true, finalUrl }
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
      if (retryErr) return { ok: false, outcome: 'upload_failed', detail: retryErr.message }
      storagePath = suffixed
    } else {
      return { ok: false, outcome: 'upload_failed', detail: upErr.message }
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
    return { ok: false, outcome: 'insert_failed', detail: insErr.message }
  }

  await admin.from('chemical_products')
    .update({ sds_source_url: finalUrl, updated_by: userId })
    .eq('id', productId).eq('tenant_id', tenantId)

  return { ok: true, sds: sds as ChemicalSdsDocumentRow, deduped: false, finalUrl }
}
