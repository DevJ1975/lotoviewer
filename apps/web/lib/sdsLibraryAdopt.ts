import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { persistFetchedSds, type PersistOutcome } from '@/lib/chemicalSdsPersist'
import {
  validateProductInput,
  isValidCas,
  type ChemicalProductInput,
  type GhsPictogram,
  type GhsSignalWord,
  type PhysicalState,
  type HazardStatement,
  type PrecautionaryStatement,
} from '@soteria/core/chemicals'

// Adopt a global SDS-library entry into a tenant's chemical catalog.
//
// Clones the library metadata into chemical_products (reusing the same
// validate + restricted-list gate as the manual create route), then fetches a
// FRESH manufacturer copy of the SDS into the TENANT's own storage via the
// shared persistFetchedSds. The library never holds a redistributed PDF; the
// adopting tenant gets its own document of record. If the fetch fails the
// product still stands, flagged (sds_fetch_pending) for a manual upload.
//
// Parsing the freshly-fetched SDS into the product's hazard fields stays the
// existing per-product Parse action (the product detail page) — adopt does not
// force an AI call so it stays fast and resilient.

type Admin = SupabaseClient

interface LibraryChemicalRow {
  id:                       string
  canonical_name:           string
  manufacturer:             string | null
  product_code:             string | null
  cas_primary:              string | null
  cas_numbers:              string[] | null
  synonyms:                 string[] | null
  physical_state:           PhysicalState | null
  ghs_pictograms:           GhsPictogram[] | null
  ghs_signal_word:          GhsSignalWord | null
  hazard_statements:        HazardStatement[] | null
  precautionary_statements: PrecautionaryStatement[] | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  ppe_required:             string[] | null
  flash_point_c:            number | null
  boiling_point_c:          number | null
  storage_class:            string | null
  incompatibilities:        string[] | null
  sds_revision_date:        string | null
  source_url:               string | null
  review_status:            string
}

export interface AdoptParams {
  tenantId:           string
  userId:             string
  libraryId:          string
  overrideRestricted: boolean
}

export type AdoptOutcome =
  | {
      ok: true
      product: Record<string, unknown>
      deduped: boolean
      sds: Record<string, unknown> | null
      sdsFetchPending: boolean
      sdsFetchOutcome: PersistOutcome | null
    }
  | { ok: false; status: number; error: string; matched?: unknown[]; requiresOverride?: boolean }

function libraryToInput(row: LibraryChemicalRow): ChemicalProductInput {
  const rawCas = (row.cas_numbers && row.cas_numbers.length > 0)
    ? row.cas_numbers
    : (row.cas_primary ? [row.cas_primary] : [])
  // Drop CAS values that fail the checksum rather than letting them block the
  // adoption — the library's CAS came from an AI proposal and may be off.
  const cas_numbers = rawCas.filter(isValidCas)

  return {
    name:                     row.canonical_name,
    manufacturer:             row.manufacturer,
    product_code:             row.product_code,
    cas_numbers,
    synonyms:                 row.synonyms ?? [],
    physical_state:           row.physical_state,
    ghs_pictograms:           row.ghs_pictograms ?? [],
    ghs_signal_word:          row.ghs_signal_word,
    hazard_statements:        row.hazard_statements,
    precautionary_statements: row.precautionary_statements,
    nfpa_health:              row.nfpa_health,
    nfpa_flammability:        row.nfpa_flammability,
    nfpa_instability:         row.nfpa_instability,
    nfpa_special:             row.nfpa_special,
    ppe_required:             row.ppe_required ?? [],
    flash_point_c:            row.flash_point_c,
    boiling_point_c:          row.boiling_point_c,
    storage_class:            row.storage_class,
    incompatibilities:        row.incompatibilities ?? [],
    sds_revision_date:        row.sds_revision_date,
    sds_source_url:           row.source_url,
    notes:                    'Adopted from the shared SDS library.',
  }
}

export async function adoptLibraryChemical(params: AdoptParams): Promise<AdoptOutcome> {
  const { tenantId, userId, libraryId, overrideRestricted } = params
  const admin = supabaseAdmin()

  const { data: lib, error: libErr } = await admin
    .from('sds_library_chemicals')
    .select('*')
    .eq('id', libraryId)
    .maybeSingle()
  if (libErr) return { ok: false, status: 500, error: libErr.message }
  if (!lib)   return { ok: false, status: 404, error: 'Library chemical not found' }
  const row = lib as LibraryChemicalRow
  if (row.review_status !== 'approved') {
    return { ok: false, status: 409, error: 'This library entry is not approved for adoption yet.' }
  }

  const input = libraryToInput(row)
  const errors = validateProductInput(input)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.map(e => `${e.field}: ${e.message}`).join('; ') }
  }

  // Dedupe — if the tenant already stocks this product, return it untouched.
  const existing = await findExistingProduct(admin, tenantId, input.name, input.manufacturer ?? null)
  if (existing) {
    return { ok: true, product: existing, deduped: true, sds: null, sdsFetchPending: false, sdsFetchOutcome: null }
  }

  // Same restricted-list gate as the manual create route.
  const { data: hits, error: hitsErr } = await admin.rpc('chemical_restricted_match', {
    p_tenant: tenantId, p_name: input.name, p_cas: input.cas_numbers ?? [],
  })
  if (hitsErr) return { ok: false, status: 500, error: hitsErr.message }
  const hitRows = (hits ?? []) as Array<{ severity: 'banned' | 'restricted' | 'discouraged' }>
  if (hitRows.some(r => r.severity === 'banned')) {
    return { ok: false, status: 409, error: 'Chemical is on the banned list. Contact your safety lead.', matched: hits ?? [] }
  }
  if (hitRows.some(r => r.severity === 'restricted') && !overrideRestricted) {
    return {
      ok: false, status: 409, requiresOverride: true, matched: hits ?? [],
      error: 'Chemical hits a restriction. Re-submit with override_restricted=true to acknowledge.',
    }
  }

  const { data: product, error: insErr } = await admin
    .from('chemical_products')
    .insert({ tenant_id: tenantId, created_by: userId, updated_by: userId, ...input })
    .select('*')
    .single()
  if (insErr) return { ok: false, status: 500, error: insErr.message }
  const productId = (product as { id: string }).id

  if (!row.source_url) {
    return { ok: true, product, deduped: false, sds: null, sdsFetchPending: false, sdsFetchOutcome: null }
  }

  const persisted = await persistFetchedSds({ tenantId, productId, url: row.source_url, userId })
  if (!persisted.ok) {
    await admin.from('chemical_products')
      .update({ sds_fetch_pending: true, updated_by: userId })
      .eq('id', productId).eq('tenant_id', tenantId)
    return { ok: true, product, deduped: false, sds: null, sdsFetchPending: true, sdsFetchOutcome: persisted.outcome }
  }
  return {
    ok: true, product, deduped: false,
    sds: persisted.sds as unknown as Record<string, unknown>,
    sdsFetchPending: false, sdsFetchOutcome: null,
  }
}

async function findExistingProduct(
  admin: Admin, tenantId: string, name: string, manufacturer: string | null,
): Promise<Record<string, unknown> | null> {
  const { data } = await admin
    .from('chemical_products')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .ilike('name', name)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const mfr = (manufacturer ?? '').toLowerCase()
  return rows.find(r => ((r.manufacturer as string | null) ?? '').toLowerCase() === mfr) ?? null
}
