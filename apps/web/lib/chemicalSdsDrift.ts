// Drift-check pipeline shared by the cron + the per-product manual button.
//
// Workflow:
//   1. Pick the product's active SDS — its file_hash is the baseline.
//   2. Fetch the manufacturer source URL with chemicalSdsFetch.
//   3. If the new bytes hash matches the baseline → outcome 'unchanged'.
//   4. If the AI extracts a revision date that is NEWER than the
//      stored sds_revision_date → upload the bytes to chemical-sds
//      bucket as a new row with parse_review_status='pending', return
//      outcome 'newer'.
//   5. If the AI revision date is OLDER → outcome 'older'; we never
//      auto-import it (manufacturer reverted is suspicious; surface
//      it to the operator).
//   6. If we cannot extract a date → outcome 'unknown'.
//   7. Always insert a chemical_sds_revision_checks row.
//
// AI usage: a tiny Sonnet call that reads only page 1 of the PDF and
// returns just the revision date string. Lighter than the full SDS
// parse — the goal is to decide WHETHER to spend a full parse, not to
// extract everything. The full parse is run via the existing
// /api/chemicals/.../parse endpoint, kicked off after the new SDS row
// is inserted.

import Anthropic from '@anthropic-ai/sdk'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchSdsPdf, type FetchOutcome } from '@/lib/chemicalSdsFetch'
import { chemicalSdsStoragePath } from '@soteria/core/chemicals'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getTenantApiKey } from '@/lib/ai/getTenantApiKey'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

const REVISION_MODEL = MODEL_BY_SURFACE['parse-sds']

export type DriftOutcome =
  | 'unchanged'
  | 'newer'
  | 'older'
  | 'unknown'
  | 'fetch_failed'

export interface DriftCheckRow {
  id:                string  // product id
  tenant_id:         string
  source_url:        string | null
  sds_revision_date: string | null
  active_sds_id:     string | null
}

export interface DriftCheckResult {
  outcome:               DriftOutcome
  http_status?:          number
  fetch_outcome?:        FetchOutcome
  latest_revision_date?: string | null
  latest_file_hash?:     string | null
  baseline_file_hash?:   string | null
  /** When outcome === 'newer', the inserted chemical_sds_documents row. */
  new_sds_id?:           string
  notes?:                string
}

interface RunArgs {
  product:      DriftCheckRow
  trigger:      'scheduled' | 'manual'
  triggeredBy?: string | null
}

interface RevisionExtractionResult {
  revision_date: string | null
  notes:         string | null
  inputTokens?:  number
  outputTokens?: number
}

const REV_DATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['revision_date', 'notes'],
  properties: {
    revision_date: { type: ['string', 'null'] },
    notes:         { type: ['string', 'null'] },
  },
} as const

const REV_PROMPT =
  `Extract the SDS REVISION DATE from this Safety Data Sheet PDF and ` +
  `return JSON. Look for "Revision date", "Date of issue (revision)", ` +
  `"Version date" — typically Section 16. Return ISO yyyy-mm-dd or null. ` +
  `Do NOT confuse with the original issue date or print date. Use notes ` +
  `for any ambiguity.`

async function extractRevisionDate(
  apiKey:   string,
  pdfBytes: Uint8Array,
): Promise<RevisionExtractionResult> {
  const client = new Anthropic({ apiKey })
  const base64 = Buffer.from(pdfBytes).toString('base64')
  const response = await client.messages.create({
    model:      REVISION_MODEL,
    max_tokens: 1000,
    system:     'You extract single fields from regulatory documents. Reply with JSON only.',
    messages: [{
      role: 'user',
      content: [
        {
          type:   'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        { type: 'text', text: REV_PROMPT },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: REV_DATE_SCHEMA } },
  })
  const block = response.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') {
    return {
      revision_date: null,
      notes:         'AI returned no text block',
      inputTokens:   response.usage?.input_tokens,
      outputTokens:  response.usage?.output_tokens,
    }
  }
  try {
    const parsed = JSON.parse(block.text) as { revision_date: string | null; notes: string | null }
    const date = typeof parsed.revision_date === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(parsed.revision_date)
        ? parsed.revision_date : null
    return {
      revision_date: date,
      notes:         parsed.notes,
      inputTokens:   response.usage?.input_tokens,
      outputTokens:  response.usage?.output_tokens,
    }
  } catch {
    return {
      revision_date: null,
      notes:         'AI returned invalid JSON',
      inputTokens:   response.usage?.input_tokens,
      outputTokens:  response.usage?.output_tokens,
    }
  }
}

/**
 * Run a drift check for a single product. Always writes a row into
 * chemical_sds_revision_checks; returns the outcome so the caller
 * (cron or manual button) can build a summary.
 */
export async function runDriftCheck(args: RunArgs): Promise<DriftCheckResult> {
  const { product } = args
  const admin = supabaseAdmin()

  const writeRow = async (outcome: DriftOutcome, extras: Partial<{
    http_status: number
    latest_revision_date: string | null
    latest_file_hash:     string | null
    baseline_file_hash:   string | null
    new_sds_id:           string
    notes:                string
  }>) => {
    try {
      await admin
        .from('chemical_sds_revision_checks')
        .insert({
          tenant_id:             product.tenant_id,
          product_id:            product.id,
          baseline_sds_id:       product.active_sds_id,
          baseline_revision_date: product.sds_revision_date,
          source_url:            product.source_url,
          http_status:           extras.http_status ?? null,
          latest_revision_date:  extras.latest_revision_date ?? null,
          latest_file_hash:      extras.latest_file_hash ?? null,
          baseline_file_hash:    extras.baseline_file_hash ?? null,
          outcome,
          new_sds_id:            extras.new_sds_id ?? null,
          notes:                 extras.notes?.slice(0, 1000) ?? null,
          trigger:               args.trigger,
          triggered_by:          args.triggeredBy ?? null,
        })
    } catch (err) {
      Sentry.captureException(err, { tags: { source: 'drift-audit' } })
    }
  }

  if (!product.source_url) {
    await writeRow('unknown', { notes: 'No source URL on product' })
    return { outcome: 'unknown', notes: 'No source URL' }
  }

  // Baseline hash lookup — needed for the "byte-identical" shortcut.
  let baselineHash: string | null = null
  if (product.active_sds_id) {
    const { data } = await admin
      .from('chemical_sds_documents')
      .select('file_hash')
      .eq('id', product.active_sds_id)
      .eq('tenant_id', product.tenant_id)
      .maybeSingle()
    baselineHash = data?.file_hash ?? null
  }

  const fetched = await fetchSdsPdf(product.source_url)
  if (fetched.outcome !== 'ok' || !fetched.bytes || !fetched.sha256) {
    await writeRow('fetch_failed', {
      http_status:        fetched.httpStatus,
      baseline_file_hash: baselineHash,
      notes:              `${fetched.outcome}${fetched.detail ? `: ${fetched.detail}` : ''}`,
    })
    return {
      outcome:       'fetch_failed',
      fetch_outcome: fetched.outcome,
      http_status:   fetched.httpStatus,
      notes:         fetched.detail,
    }
  }

  // Byte-identical → unchanged. No AI call needed.
  if (baselineHash && baselineHash === fetched.sha256) {
    await writeRow('unchanged', {
      http_status:        fetched.httpStatus,
      latest_file_hash:   fetched.sha256,
      baseline_file_hash: baselineHash,
    })
    return {
      outcome:           'unchanged',
      http_status:       fetched.httpStatus,
      latest_file_hash:  fetched.sha256,
      baseline_file_hash: baselineHash,
    }
  }

  // Different bytes → ask the AI for the revision date.
  const apiKey = await getTenantApiKey(product.tenant_id)
  if (!apiKey) {
    await writeRow('unknown', {
      http_status:      fetched.httpStatus,
      latest_file_hash: fetched.sha256,
      baseline_file_hash: baselineHash,
      notes:            'AI not configured; cannot extract revision date',
    })
    return {
      outcome:          'unknown',
      http_status:      fetched.httpStatus,
      latest_file_hash: fetched.sha256,
      notes:            'AI not configured',
    }
  }

  let extraction: RevisionExtractionResult
  try {
    extraction = await extractRevisionDate(apiKey, fetched.bytes)
    // ai_invocations.user_id is NOT NULL — log only on manual
    // triggers where we have a real user. Scheduled cron rows live
    // in chemical_sds_revision_checks for the per-product audit.
    if (args.triggeredBy) {
      await logAiInvocation({
        userId:       args.triggeredBy,
        tenantId:     product.tenant_id,
        surface:      'parse-sds',     // share quota with the full parse
        model:        REVISION_MODEL,
        status:       'success',
        inputTokens:  extraction.inputTokens,
        outputTokens: extraction.outputTokens,
        context:      product.id,
      })
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'drift-extract' } })
    if (args.triggeredBy) {
      await logAiInvocation({
        userId:   args.triggeredBy,
        tenantId: product.tenant_id,
        surface:  'parse-sds',
        model:    REVISION_MODEL,
        status:   'error',
        context:  product.id,
      })
    }
    await writeRow('unknown', {
      http_status:      fetched.httpStatus,
      latest_file_hash: fetched.sha256,
      baseline_file_hash: baselineHash,
      notes:            err instanceof Error ? err.message : String(err),
    })
    return {
      outcome:          'unknown',
      http_status:      fetched.httpStatus,
      latest_file_hash: fetched.sha256,
      notes:            'AI extraction failed',
    }
  }

  const latest   = extraction.revision_date
  const baseline = product.sds_revision_date

  // Compare. If we cannot tell which is newer, file as 'unknown'.
  let outcome: DriftOutcome = 'unknown'
  if (latest && baseline) {
    if (latest === baseline) outcome = 'unchanged'
    else if (latest > baseline) outcome = 'newer'
    else outcome = 'older'
  } else if (latest && !baseline) {
    outcome = 'newer'
  } else if (!latest && !baseline) {
    outcome = 'unchanged'  // bytes differ but neither has a date — best effort
  }

  // Nothing to import for unchanged / older / unknown. Just log + return.
  if (outcome !== 'newer') {
    await writeRow(outcome, {
      http_status:         fetched.httpStatus,
      latest_revision_date: latest,
      latest_file_hash:    fetched.sha256,
      baseline_file_hash:  baselineHash,
      notes:               extraction.notes ?? undefined,
    })
    return {
      outcome,
      http_status:          fetched.httpStatus,
      latest_revision_date: latest,
      latest_file_hash:     fetched.sha256,
      baseline_file_hash:   baselineHash,
      notes:                extraction.notes ?? undefined,
    }
  }

  // Newer revision detected. Upload + insert as pending review.
  // Storage path mirrors the manual upload route's layout.
  const filename    = `revision-${latest}.pdf`
  const storagePath = chemicalSdsStoragePath(product.tenant_id, product.id, filename)

  const { error: upErr } = await admin
    .storage
    .from('chemical-sds')
    .upload(storagePath, fetched.bytes, {
      contentType:  'application/pdf',
      cacheControl: '3600',
      upsert:       false,
    })
  if (upErr && !/already exists/i.test(upErr.message)) {
    await writeRow('unknown', {
      http_status:        fetched.httpStatus,
      latest_revision_date: latest,
      latest_file_hash:   fetched.sha256,
      baseline_file_hash: baselineHash,
      notes:              `Upload failed: ${upErr.message}`,
    })
    return {
      outcome: 'unknown',
      notes:   `Upload failed: ${upErr.message}`,
    }
  }

  const { data: inserted, error: insErr } = await admin
    .from('chemical_sds_documents')
    .insert({
      tenant_id:    product.tenant_id,
      product_id:   product.id,
      revision_date: latest,
      language:     'en',
      storage_path: storagePath,
      file_hash:    fetched.sha256,
      file_bytes:   fetched.bytes.byteLength,
      mime_type:    'application/pdf',
      source:       'ai_fetch',
      parse_review_status: 'pending',
      created_by:   args.triggeredBy ?? null,
    })
    .select('id')
    .single()
  if (insErr) {
    // Hash UNIQUE collision → we already have this revision stored.
    // Treat that as 'unchanged' rather than an error.
    if (/duplicate key|unique/i.test(insErr.message)) {
      await writeRow('unchanged', {
        http_status:         fetched.httpStatus,
        latest_revision_date: latest,
        latest_file_hash:    fetched.sha256,
        baseline_file_hash:  baselineHash,
        notes:               'Revision already stored',
      })
      return { outcome: 'unchanged', latest_revision_date: latest }
    }
    await writeRow('unknown', {
      http_status:        fetched.httpStatus,
      latest_revision_date: latest,
      latest_file_hash:   fetched.sha256,
      baseline_file_hash: baselineHash,
      notes:              `Insert failed: ${insErr.message}`,
    })
    return { outcome: 'unknown', notes: `Insert failed: ${insErr.message}` }
  }

  await writeRow('newer', {
    http_status:        fetched.httpStatus,
    latest_revision_date: latest,
    latest_file_hash:   fetched.sha256,
    baseline_file_hash: baselineHash,
    new_sds_id:         inserted.id,
    notes:              extraction.notes ?? undefined,
  })

  // Push fanout to tenant safety leads (owner / admin) so the new
  // revision doesn't sit unnoticed in the review queue. Best-effort —
  // VAPID-misconfigured tenants are expected to still have the row.
  try {
    const { data: admins } = await admin
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', product.tenant_id)
      .in('role', ['owner', 'admin'])
    const profileIds = Array.from(new Set(
      (admins ?? []).map(a => a.user_id).filter((u): u is string => !!u),
    ))

    const { data: prod } = await admin
      .from('chemical_products')
      .select('name, manufacturer')
      .eq('id', product.id)
      .eq('tenant_id', product.tenant_id)
      .maybeSingle<{ name: string; manufacturer: string | null }>()
    const productLabel = prod?.name
      ? prod.manufacturer ? `${prod.name} (${prod.manufacturer})` : prod.name
      : 'a chemical'

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
      ?? 'https://soteriafield.app'

    if (profileIds.length > 0) {
      await dispatchPushToProfiles({
        payload: {
          title: 'New SDS revision detected',
          body:  `${productLabel} has a newer SDS dated ${latest}. Review the parsed fields before they apply.`,
          url:   `${appUrl}/chemicals/review`,
          tag:   `sds-drift:${product.id}`,
        },
        profileIds,
        source: 'chemicals/drift-newer',
      })
    }
  } catch (pushErr) {
    Sentry.captureException(pushErr, { tags: { source: 'drift-push' } })
  }

  return {
    outcome:              'newer',
    http_status:          fetched.httpStatus,
    latest_revision_date: latest,
    latest_file_hash:     fetched.sha256,
    baseline_file_hash:   baselineHash,
    new_sds_id:           inserted.id,
    notes:                extraction.notes ?? undefined,
  }
}
