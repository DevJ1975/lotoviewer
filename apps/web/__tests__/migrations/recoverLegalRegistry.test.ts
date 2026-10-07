import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 298 restores three tables that exist in production but in no
// committed migration. The property that matters is that it is SAFE TO RUN IN
// PRODUCTION: it may create what is missing and nothing else. Behaviour was run
// against Postgres 16 both on a fresh database and on one where the tables
// already existed with their own policy and data (recorded in the PR).

const sql = readFileSync(resolve(__dirname, '../../migrations/298_recover_legal_registry.sql'), 'utf8')
const code = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const baseline = JSON.parse(readFileSync(resolve(__dirname, '../../../../scripts/migration-drift-baseline.json'), 'utf8'))

describe('Migration 298 — legal registry recovery', () => {
  it('only ever creates what is missing: no drop, truncate, delete or alter-column', () => {
    expect(code).not.toMatch(/\bdrop\b/i)
    expect(code).not.toMatch(/\btruncate\b/i)
    expect(code).not.toMatch(/\bdelete\s+from\b/i)
    expect(code).not.toMatch(/\balter\s+table\b[^;]*\b(drop|alter\s+column|rename|add)\b/i)
  })

  it('creates each of the three tables with if-not-exists', () => {
    for (const table of ['legal_register', 'compliance_obligations', 'compliance_obligation_completions']) {
      expect(code).toContain(`create table if not exists public.${table}`)
    }
  })

  it('enables row-level security on all three', () => {
    for (const table of ['legal_register', 'compliance_obligations', 'compliance_obligation_completions']) {
      expect(code).toContain(`alter table public.${table} enable row level security`)
    }
  })

  it("adds a baseline policy only where a table has none, so production's own policies are never touched", () => {
    expect(code).toContain("if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t)")
    // The only policy-creating statement is that guarded one.
    expect(code.match(/create policy/g)).toHaveLength(1)
  })

  it('scopes the baseline policy to the tenant', () => {
    expect(code).toContain('public.active_tenant_id() is null or tenant_id = public.active_tenant_id()')
    expect(code).toContain('tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin()')
  })

  it('states plainly that it is a reconstruction, not the production ledger body', () => {
    expect(sql).toMatch(/RECONSTRUCTION, NOT THE BYTE-IDENTICAL LEDGER BODY/)
  })

  it('is recorded in the drift baseline as recovered, no longer out-of-band', () => {
    expect(baseline.ledger_aliases.compliance_calendar_and_legal_registry_139).toBe('298_recover_legal_registry.sql')
    expect(baseline.db_out_of_band['20260513205353']).toBeUndefined()
  })
})
