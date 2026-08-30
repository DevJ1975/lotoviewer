import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 233 introduces the global (system-wide) SDS reference library.
// These assertions lock the load-bearing invariants of the schema: it must
// stay tenant-agnostic, read-all / write-superadmin (the prop65 posture), and
// idempotent. Mirrors the migration-text assertions in
// __tests__/regression/sessionFixes.regression.test.ts (#186).

const REPO_APPS_WEB = resolve(__dirname, '../..')
const sql = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/233_sds_library.sql'),
  'utf8',
)

// Structural assertions (no tenant_id column, transaction wrapper) must look
// at SQL only — the header comment legitimately discusses "tenant_id" and
// "tenant-scoped", which would otherwise trip the column check.
const sqlNoComments = sql.replace(/--[^\n]*/g, '').replace(/\n{2,}/g, '\n').trim()

const TABLES = [
  'sds_library_chemicals',
  'sds_library_sources',
  'sds_library_seed_runs',
  'sds_library_seed_items',
] as const

describe('Migration 233 — global SDS reference library', () => {
  it('creates all four library tables idempotently', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`create table if not exists public.${t}`)
    }
  })

  it('is system-wide — no tenant_id on any library table', () => {
    // The whole point of the library is cross-tenant reuse. A tenant_id
    // column would re-scope it and defeat the feature.
    expect(sqlNoComments).not.toMatch(/\btenant_id\b/)
  })

  it('enables RLS on every table', () => {
    // Alignment padding between the table name and `enable` varies, so match
    // on flexible whitespace rather than an exact spacing.
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`))
    }
  })

  it('grants read to all authenticated users and writes to superadmins only', () => {
    for (const t of TABLES) {
      expect(sql).toContain(`"${t}_read_all"`)
      expect(sql).toContain(`"${t}_write_superadmin"`)
    }
    // Read policy is unconditional; write policy is gated on is_superadmin().
    expect(sql).toMatch(/for select to authenticated\s*\n\s*using \(true\)/)
    expect(sql).toContain('using (public.is_superadmin())')
    expect(sql).toContain('with check (public.is_superadmin())')
  })

  it('dedupes the catalog by (name, manufacturer, primary CAS), not by CAS alone', () => {
    expect(sql).toContain('uq_sds_library_identity')
    expect(sql).toMatch(
      /lower\(canonical_name\), coalesce\(manufacturer, ''\), coalesce\(cas_primary, ''\)/,
    )
  })

  it('stores a source URL + verification hash but never a stored PDF column', () => {
    // The copyright posture: the library points at the manufacturer doc,
    // it does not hold a storage_path / file_bytes like chemical_sds_documents.
    expect(sql).toContain('source_url')
    expect(sql).toContain('last_verified_fetch_hash')
    expect(sql).not.toContain('storage_path')
    expect(sql).not.toMatch(/\bfile_bytes\b/)
  })

  it('audits library content but not transient seed bookkeeping', () => {
    expect(sql).toContain('trg_audit_sds_library_chemicals')
    expect(sql).toContain('trg_audit_sds_library_sources')
    expect(sql).not.toContain('trg_audit_sds_library_seed_runs')
    expect(sql).not.toContain('trg_audit_sds_library_seed_items')
  })

  it('wraps the migration in a single transaction and reloads PostgREST', () => {
    expect(sqlNoComments.startsWith('begin;')).toBe(true)
    expect(sqlNoComments.endsWith('commit;')).toBe(true)
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
