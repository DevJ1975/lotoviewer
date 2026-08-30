import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchSdsPdf } from '@/lib/chemicalSdsFetch'
import { verifyPDF } from '@/lib/security/magicBytes'

// Re-verify the global library's source URLs (link-rot + manufacturer-revision
// drift). Hash-only: we fetch the PDF, compare its sha256 to the last verified
// hash, and record the outcome — we never STORE the PDF (the no-redistribution
// stance). A changed hash flips the entry to 'needs_research' so a human looks
// at the manufacturer's new revision before tenants keep adopting the old URL.

const STALE_DAYS = 30

export interface VerifyBatchResult {
  checked:   number
  unchanged: number
  changed:   number
  failed:    number
  remaining: number
}

function staleCutoffIso(): string {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - STALE_DAYS)
  return cutoff.toISOString()
}

interface LibRow {
  id:                       string
  source_url:               string | null
  last_verified_fetch_hash: string | null
}

export async function verifyLibraryBatch(params: { max: number }): Promise<VerifyBatchResult> {
  const { max } = params
  const admin = supabaseAdmin()
  const cutoffIso = staleCutoffIso()
  const result: VerifyBatchResult = { checked: 0, unchanged: 0, changed: 0, failed: 0, remaining: 0 }

  const { data, error } = await admin
    .from('sds_library_chemicals')
    .select('id, source_url, last_verified_fetch_hash')
    .eq('review_status', 'approved')
    .not('source_url', 'is', null)
    .or(`last_verified_at.is.null,last_verified_at.lt.${cutoffIso}`)
    .order('last_verified_at', { ascending: true, nullsFirst: true })
    .limit(max)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as LibRow[]

  for (const row of rows) {
    if (!row.source_url) continue
    result.checked += 1
    const now = new Date().toISOString()
    const fr = await fetchSdsPdf(row.source_url, { allowAnyHost: true })

    if (fr.outcome === 'ok' && fr.bytes && fr.sha256 && verifyPDF(fr.bytes)) {
      const changed = !!row.last_verified_fetch_hash && row.last_verified_fetch_hash !== fr.sha256
      await admin.from('sds_library_chemicals').update({
        last_verified_at:         now,
        last_verified_fetch_hash: fr.sha256,
        last_verify_outcome:      changed ? 'changed' : 'ok',
        ...(changed ? { review_status: 'needs_research' } : {}),
      }).eq('id', row.id)
      if (changed) result.changed += 1
      else result.unchanged += 1
    } else {
      await admin.from('sds_library_chemicals').update({
        last_verified_at:    now,
        last_verify_outcome: fr.outcome === 'ok' ? 'not_pdf' : fr.outcome,
      }).eq('id', row.id)
      result.failed += 1
    }
  }

  const { count } = await admin
    .from('sds_library_chemicals')
    .select('id', { count: 'exact', head: true })
    .eq('review_status', 'approved')
    .not('source_url', 'is', null)
    .or(`last_verified_at.is.null,last_verified_at.lt.${cutoffIso}`)
  result.remaining = count ?? 0

  return result
}
