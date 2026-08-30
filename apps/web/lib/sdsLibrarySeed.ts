import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic } from '@/lib/ai/client'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { discoverSds, type SdsCandidate } from '@/lib/ai/discoverSds'

// SDS-library seeding engine — the per-item research pass shared by the
// superadmin "/research" route and the seed-drip cron.
//
// For each APPROVED seed item: run discoverSds to find candidate manufacturer
// SDS URLs, then write a global sds_library_chemicals row (identity + the best
// official source URL, review_status='pending') plus a sds_library_sources row
// per candidate. This is URL-ONLY seeding — we deliberately do NOT fetch or
// parse the PDF here. Full metadata is parsed at ADOPT time (Phase 3), when a
// fresh copy is fetched into the adopting tenant's own storage; that keeps
// seeding cheap and avoids the library ever holding a redistributed PDF.
//
// Idempotency/resumability lives in sds_library_seed_items.status: an item is
// claimed (-> 'researching', attempts++) before its discover call, then moved
// to 'found' / 'not_found', or back to 'approved' to retry (or 'error' once
// attempts are exhausted). If a run crashes or times out mid-item, the next
// batch reclaims items stuck in 'researching' past RESEARCHING_LEASE_MS so the
// run can finish instead of stalling forever on an orphaned claim.

const DISCOVER_MODEL = MODEL_BY_SURFACE['discover-sds']
const MAX_ATTEMPTS = 3
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// A 'researching' claim older than this is from a run that crashed or timed out
// (the function ceiling is 300s). 3× that ceiling leaves a still-running batch's
// in-flight items alone while still recovering orphaned ones within a cycle.
const RESEARCHING_LEASE_MS = 15 * 60 * 1000
const STALE_LEASE_ERROR = 'Reclaimed after the researching lease expired (run crashed or timed out)'

type Admin = SupabaseClient

export interface ResearchBatchResult {
  processed: number
  found:     number
  notFound:  number
  errored:   number
  /** Approved items still awaiting research after this batch. */
  remaining: number
  /** True once no proposed/approved/researching items remain (run is done). */
  completed: boolean
}

interface SeedItemRow {
  id:                    string
  proposed_name:         string
  proposed_cas:          string | null
  proposed_manufacturer: string | null
  attempts:              number
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

function isoDateOrNull(value: string | null): string | null {
  return value && ISO_DATE_RE.test(value) ? value : null
}

/**
 * Process up to `max` approved items for a seed run. Never throws on a
 * single item's failure — only on run-level problems (missing run, no
 * Anthropic key) so the route can map those to a clean HTTP status.
 */
export async function researchSeedBatch(params: {
  seedRunId: string
  max:       number
}): Promise<ResearchBatchResult> {
  const { seedRunId, max } = params
  const admin = supabaseAdmin()
  const result: ResearchBatchResult = {
    processed: 0, found: 0, notFound: 0, errored: 0, remaining: 0, completed: false,
  }

  const { data: run, error: runErr } = await admin
    .from('sds_library_seed_runs')
    .select('id, status, created_by')
    .eq('id', seedRunId)
    .maybeSingle()
  if (runErr) throw new Error(runErr.message)
  if (!run)   throw new Error('Seed run not found')
  const createdBy = (run as { created_by: string | null }).created_by

  // Recover items orphaned in 'researching' by a prior crashed/timed-out batch
  // before selecting work, so they rejoin this batch (or terminate the run).
  await reclaimStaleResearching(admin, seedRunId)

  const { data: items, error: itemsErr } = await admin
    .from('sds_library_seed_items')
    .select('id, proposed_name, proposed_cas, proposed_manufacturer, attempts')
    .eq('seed_run_id', seedRunId)
    .eq('status', 'approved')
    .order('created_at', { ascending: true })
    .limit(max)
  if (itemsErr) throw new Error(itemsErr.message)
  const batch = (items ?? []) as SeedItemRow[]

  if (batch.length === 0) {
    result.completed = await finalizeRunCounts(admin, seedRunId, false)
    result.remaining = 0
    return result
  }

  // Create the client once. A config error (no key) aborts the batch WITHOUT
  // burning item attempts — it's not the items' fault. The route maps the
  // throw via aiErrorToResponse.
  const client = await getAnthropic(null)
  await admin.from('sds_library_seed_runs').update({ status: 'researching' }).eq('id', seedRunId)

  for (const item of batch) {
    result.processed += 1
    const attempts = item.attempts + 1
    await admin.from('sds_library_seed_items')
      .update({ status: 'researching', attempts, last_attempt_at: new Date().toISOString(), last_error: null })
      .eq('id', item.id)

    try {
      const { candidates, usage } = await discoverSds(client, {
        productName:  item.proposed_name,
        manufacturer: item.proposed_manufacturer,
        productCode:  null,
      })
      await logSeedAi(createdBy, 'success', item.id, usage)

      if (candidates.length === 0) {
        await admin.from('sds_library_seed_items').update({ status: 'not_found' }).eq('id', item.id)
        result.notFound += 1
        continue
      }

      const chemicalId = await upsertLibraryChemical(admin, seedRunId, item, candidates)
      await admin.from('sds_library_seed_items')
        .update({ status: 'found', chemical_id: chemicalId })
        .eq('id', item.id)
      result.found += 1
    } catch (err) {
      await logSeedAi(createdBy, 'error', item.id)
      const msg = err instanceof Error ? err.message : String(err)
      const exhausted = attempts >= MAX_ATTEMPTS
      await admin.from('sds_library_seed_items')
        .update({ status: exhausted ? 'error' : 'approved', last_error: msg })
        .eq('id', item.id)
      if (exhausted) result.errored += 1
    }
  }

  // Refresh the run's counts snapshot + completion. We just processed a
  // batch, so keep it 'researching' unless everything is now terminal.
  result.completed = await finalizeRunCounts(admin, seedRunId, true)
  const { count: remaining } = await admin
    .from('sds_library_seed_items')
    .select('id', { count: 'exact', head: true })
    .eq('seed_run_id', seedRunId)
    .eq('status', 'approved')
  result.remaining = remaining ?? 0
  return result
}

// ── helpers ──────────────────────────────────────────────────────────────

async function logSeedAi(
  userId:  string | null,
  status:  'success' | 'error',
  context: string,
  usage?:  { inputTokens: number; outputTokens: number },
): Promise<void> {
  // ai_invocations.user_id is NOT NULL → attribute seeding cost to the
  // superadmin who created the run. If the run somehow has no creator, skip
  // logging rather than violate the FK.
  if (!userId) return
  await logAiInvocation({
    userId, tenantId: null, surface: 'discover-sds', model: DISCOVER_MODEL,
    status, context,
    inputTokens:  usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  })
}

/**
 * Insert (or reuse, on identity collision) the global library row for this
 * item, then record every candidate as a source. Returns the chemical id.
 */
async function upsertLibraryChemical(
  admin:      Admin,
  seedRunId:  string,
  item:       SeedItemRow,
  candidates: SdsCandidate[],
): Promise<string> {
  const best = candidates[0]
  // Resolve once so the collision lookup can match the exact identity we wrote.
  const manufacturer = best.manufacturer || item.proposed_manufacturer || null
  const { data: inserted, error } = await admin
    .from('sds_library_chemicals')
    .insert({
      canonical_name:    item.proposed_name,
      manufacturer,
      cas_primary:       item.proposed_cas,
      cas_numbers:       item.proposed_cas ? [item.proposed_cas] : [],
      source_url:        best.url,
      source_host:       hostOf(best.url),
      sds_revision_date: isoDateOrNull(best.revisionDate),
      review_status:     'pending',
      seed_run_id:       seedRunId,
    })
    .select('id')
    .single()

  let chemicalId: string
  if (error) {
    // uq_sds_library_identity collision — this chemical is already in the
    // library (e.g. a prior run). Reuse it and just attach the new sources.
    if (error.code === '23505') {
      const existingId = await findExistingChemical(admin, {
        name: item.proposed_name, manufacturer, cas: item.proposed_cas,
      })
      if (!existingId) throw new Error(`identity collision but lookup failed: ${error.message}`)
      chemicalId = existingId
    } else {
      throw new Error(error.message)
    }
  } else {
    chemicalId = (inserted as { id: string }).id
  }

  const sourceRows = candidates.map((c, idx) => ({
    chemical_id:   chemicalId,
    url:           c.url,
    host:          hostOf(c.url),
    title:         c.title || null,
    confidence:    c.confidence,
    reasons:       c.reasonsItMatches || null,
    is_primary:    idx === 0,
    revision_date: isoDateOrNull(c.revisionDate),
  }))
  await admin
    .from('sds_library_sources')
    .upsert(sourceRows, { onConflict: 'chemical_id,url', ignoreDuplicates: true })

  return chemicalId
}

interface ChemicalIdentity {
  name:         string
  manufacturer: string | null
  cas:          string | null
}

/**
 * Find the library row that collided on uq_sds_library_identity —
 * (lower(canonical_name), coalesce(manufacturer,''), coalesce(cas_primary,'')).
 * Narrow by name in the DB (ilike, wildcards escaped — see escapeLike), then
 * match the coalesced manufacturer/CAS in JS against the exact values we tried
 * to insert. manufacturer/CAS are compared case-sensitively to mirror the index
 * (only canonical_name is lower()'d there). A 23505 guarantees such a row
 * exists; returning null on no match lets the caller surface the inconsistency
 * rather than silently attaching sources to the wrong chemical.
 */
async function findExistingChemical(admin: Admin, identity: ChemicalIdentity): Promise<string | null> {
  const { data } = await admin
    .from('sds_library_chemicals')
    .select('id, canonical_name, manufacturer, cas_primary')
    .ilike('canonical_name', escapeLike(identity.name))
  const rows = (data ?? []) as Array<{
    id: string; canonical_name: string; manufacturer: string | null; cas_primary: string | null
  }>
  const name = identity.name.toLowerCase()
  const mfr  = identity.manufacturer ?? ''
  const cas  = identity.cas ?? ''
  const match = rows.find(r =>
    r.canonical_name.toLowerCase() === name &&
    (r.manufacturer ?? '') === mfr &&
    (r.cas_primary ?? '') === cas)
  return match?.id ?? null
}

// PostgREST hands the ilike pattern straight to SQL ILIKE, where % and _ are
// wildcards and \ escapes them. Chemical names can contain these (e.g.
// "Hydrogen peroxide 30%"), so escape them to keep the lookup an exact match.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

/**
 * Reclaim items orphaned in 'researching' by a run that crashed or timed out
 * mid-item. finalizeRunCounts counts 'researching' as pending, so without this
 * a dead run's leftovers would keep it from ever completing. Items still under
 * the attempt cap go back to 'approved' to retry; exhausted ones go to 'error'
 * so the run can finish. Only claims older than the lease are touched, leaving
 * a concurrently-running batch's in-flight items alone.
 */
async function reclaimStaleResearching(admin: Admin, seedRunId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - RESEARCHING_LEASE_MS).toISOString()

  // Exhausted the attempt cap → give up so the run can complete.
  await admin.from('sds_library_seed_items')
    .update({ status: 'error', last_error: STALE_LEASE_ERROR })
    .eq('seed_run_id', seedRunId)
    .eq('status', 'researching')
    .lt('last_attempt_at', staleBefore)
    .gte('attempts', MAX_ATTEMPTS)

  // Retries remaining → back to the approved queue for the next batch.
  await admin.from('sds_library_seed_items')
    .update({ status: 'approved' })
    .eq('seed_run_id', seedRunId)
    .eq('status', 'researching')
    .lt('last_attempt_at', staleBefore)
    .lt('attempts', MAX_ATTEMPTS)
}

/**
 * Recompute the run's per-status counts snapshot and flip it to 'completed'
 * when nothing is left to do. Returns whether the run is complete.
 */
async function finalizeRunCounts(admin: Admin, seedRunId: string, processedBatch: boolean): Promise<boolean> {
  const { data } = await admin
    .from('sds_library_seed_items')
    .select('status')
    .eq('seed_run_id', seedRunId)
  const tally: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{ status: string }>) {
    tally[r.status] = (tally[r.status] ?? 0) + 1
  }
  const pending = (tally['proposed'] ?? 0) + (tally['approved'] ?? 0) + (tally['researching'] ?? 0)
  const completed = pending === 0

  const update: Record<string, unknown> = { counts: tally }
  if (completed) update.status = 'completed'
  else if (processedBatch) update.status = 'researching'
  await admin.from('sds_library_seed_runs').update(update).eq('id', seedRunId)

  return completed
}
