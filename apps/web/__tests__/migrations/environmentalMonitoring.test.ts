import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 318 (environmental monitoring) read as text. The behaviour is proved against a real
// Postgres in environmentalMonitoring.db.test.ts; these checks pin the properties that a later
// edit could weaken without any single query noticing: who may write, that the rollback touches
// only what 318 created, and that the rules stay in the database rather than in the screens.

const dir = resolve(__dirname, '../../migrations')
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8')
const strip = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const MIGRATION = '318_environmental_monitoring.sql'
const ROLLBACK = '318_rollback.sql'
const code = strip(read(MIGRATION))
const rollback = strip(read(ROLLBACK))

const policy = (name: string) => code.match(new RegExp(`create policy ${name}[^;]*;`))?.[0] ?? ''

describe('migration 318: structure', () => {
  it('has a rollback, and both run in one transaction', () => {
    expect(existsSync(resolve(dir, ROLLBACK))).toBe(true)
    for (const sql of [code, rollback]) {
      expect(sql).toMatch(/^begin;/)
      expect(sql).toMatch(/commit;$/)
    }
  })

  it('reloads the PostgREST schema cache in both directions', () => {
    expect(code).toContain("notify pgrst, 'reload schema';")
    expect(rollback).toContain("notify pgrst, 'reload schema';")
  })

  it('is idempotent: tables and indexes are created if absent, and every policy and trigger is dropped before it is created', () => {
    expect(code.match(/create table (?!if not exists)/g)).toBeNull()
    expect(code.match(/create (unique )?index (?!if not exists)/g)).toBeNull()
    for (const name of code.match(/create policy \w+/g) ?? []) {
      expect(code, name).toContain(`drop policy if exists ${name.replace('create policy ', '')}`)
    }
    for (const name of code.match(/create trigger \w+/g) ?? []) {
      expect(code, name).toContain(`drop trigger if exists ${name.replace('create trigger ', '')}`)
    }
  })

  it('never opens a table to everyone: no policy uses (true), and every policy is for authenticated users', () => {
    expect(code).not.toMatch(/using \( ?true ?\)/i)
    expect(code).not.toMatch(/with check \( ?true ?\)/i)
    const policies = code.match(/create policy [^;]*?;/g) ?? []
    expect(policies).toHaveLength(6)
    for (const p of policies) expect(p, p.slice(0, 50)).toMatch(/to authenticated/)
  })

  it('enables row level security on both tables', () => {
    expect(code).toContain('alter table public.monitoring_limits enable row level security;')
    expect(code).toContain('alter table public.monitoring_results enable row level security;')
  })

  it('stamps updated_at and writes the audit log for both tables', () => {
    for (const table of ['monitoring_limits', 'monitoring_results']) {
      expect(code, table).toContain(`create trigger trg_${table}_touch before update on public.${table}`)
      expect(code, table).toContain(`create trigger trg_audit_${table} after insert or update or delete on public.${table}`)
    }
    expect(code).toContain("execute function public.log_audit('id')")
  })
})

describe('migration 318: who may write', () => {
  it('lets only tenant admins write limits', () => {
    const write = policy('monitoring_limits_admin_write')
    expect(write).toContain('for all')
    expect(write.match(/current_user_admin_tenant_ids\(\)/g)).toHaveLength(2)
    expect(write).not.toMatch(/current_user_tenant_ids\(\)/)
  })

  it('lets members read limits and results, never write them', () => {
    expect(policy('monitoring_limits_read')).toMatch(/for select/)
    expect(policy('monitoring_results_read')).toMatch(/for select/)
    expect(policy('monitoring_limits_read')).toContain('current_user_tenant_ids()')
  })

  it('lets a member add a result only as themselves', () => {
    const insert = policy('monitoring_results_member_insert')
    expect(insert).toContain('for insert')
    expect(insert).toContain('current_user_tenant_ids()')
    expect(insert).toContain('sampled_by = auth.uid()')
    expect(insert).not.toContain('using')
  })

  it('lets only tenant admins change or delete a result: neither policy mentions plain membership', () => {
    for (const name of ['monitoring_results_admin_update', 'monitoring_results_admin_delete']) {
      expect(policy(name), name).toContain('current_user_admin_tenant_ids()')
      expect(policy(name), name).not.toMatch(/current_user_tenant_ids\(\)/)
    }
    expect(policy('monitoring_results_admin_update')).toContain('for update')
    expect(policy('monitoring_results_admin_delete')).toContain('for delete')
  })

  it('has no policy that lets a member update or delete results: every update, delete or all policy is admin-only', () => {
    const writes = (code.match(/create policy [^;]*?;/g) ?? []).filter(p => /for (update|delete|all)/.test(p))
    expect(writes.length).toBe(3)
    for (const p of writes) expect(p, p.slice(0, 60)).toContain('current_user_admin_tenant_ids()')
  })

  it('scopes every policy to the active tenant and, when there is one, the active site', () => {
    const policies = code.match(/create policy [^;]*?;/g) ?? []
    for (const p of policies) {
      expect(p, p.slice(0, 50)).toContain('public.active_tenant_id() is null or tenant_id = public.active_tenant_id()')
      expect(p, p.slice(0, 50)).toContain('public.active_facility_id() is null or facility_id = public.active_facility_id()')
    }
  })
})

describe('migration 318: what the database holds', () => {
  it('binds both tables to their site by a composite foreign key that cascades with the site', () => {
    expect(code.match(/foreign key \(tenant_id, facility_id\) references public\.facilities\(tenant_id, id\) on delete cascade/g)).toHaveLength(2)
  })

  it('holds an outfall to its own site: a composite key, on a unique key added to stormwater_outfalls', () => {
    expect(code).toContain('add constraint stormwater_outfalls_tenant_facility_id_key unique (tenant_id, facility_id, id)')
    expect(code.match(/foreign key \(tenant_id, facility_id, outfall_id\) references public\.stormwater_outfalls \(tenant_id, facility_id, id\)/g)).toHaveLength(2)
  })

  it('never cascades or clears an outfall reference: an outfall with records cannot be deleted', () => {
    const outfallReferences = code.match(/foreign key \(tenant_id, facility_id, outfall_id\)[^,;]*references public\.stormwater_outfalls \([^)]*\)[^,;)]*/g) ?? []
    expect(outfallReferences).toHaveLength(2)
    for (const reference of outfallReferences) expect(reference).not.toMatch(/on delete (cascade|set null|set default)/)
  })

  it('holds a limit\'s permit to its own site, using the key 313 added to the permit vault, and creates no permit table', () => {
    expect(code).toContain('foreign key (tenant_id, facility_id, permit_id) references public.environmental_permits (tenant_id, facility_id, id) on delete set null (permit_id)')
    expect(code).not.toMatch(/create table (if not exists )?public\.environmental_permits\b/)
  })

  it('keeps the distinction between a permit limit and a benchmark or action level in the basis column', () => {
    expect(code).toContain("check (basis in ('permit_limit','benchmark','numeric_action_level','local_limit','self_imposed'))")
    expect(code).toContain("check (limit_kind in ('instantaneous_max','instantaneous_min','daily_max','monthly_average','annual_average'))")
  })

  it('makes "no outfall" one slot for a library limit, so adopting twice adds nothing', () => {
    expect(code).toContain('create unique index if not exists uq_monitoring_limits_library on public.monitoring_limits (tenant_id, facility_id, outfall_id, library_key) nulls not distinct where library_key is not null')
    expect(code).toContain("constraint monitoring_limits_library_key_iff_library check ((source = 'library') = (library_key is not null))")
  })

  it('keeps a result\'s evidence in the tenant\'s own folder: prefix, no "..", at most 300 characters', () => {
    expect(code).toContain("left(evidence_id, length(tenant_id::text) + 1) = tenant_id::text || '/'")
    expect(code).toContain("position('..' in evidence_id) = 0")
    expect(code).toContain('length(evidence_id) <= 300')
  })

  it('refuses a negative value and keeps the free text bounded', () => {
    expect(code.match(/value +numeric not null check \(value >= 0\)/g)).toHaveLength(2)
    expect(code).toContain('lab is null or length(lab) <= 120')
    expect(code).toContain('note is null or length(note) <= 2000')
  })

  it('has covering indexes for the query shapes: the latest results of a site, and a subject\'s parameter over time', () => {
    expect(code).toContain('idx_monitoring_results_site_time on public.monitoring_results (tenant_id, facility_id, sampled_at desc, id desc)')
    expect(code).toContain('idx_monitoring_results_subject on public.monitoring_results (tenant_id, facility_id, outfall_id, parameter, sampled_at desc)')
    expect(code).toContain('idx_monitoring_limits_site on public.monitoring_limits (tenant_id, facility_id, outfall_id)')
  })
})

describe('318 rollback', () => {
  it('says what it destroys, and where it must run in the order of rollbacks', () => {
    const text = read(ROLLBACK)
    expect(text).toMatch(/DESTRUCTIVE/)
    expect(text).toMatch(/before 313_rollback\.sql/)
  })

  it('drops only the two tables 318 created and the one key it added to outfalls, in that order', () => {
    const statements = rollback.replace(/^begin; /, '').replace(/ notify pgrst.*$/, '').split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toEqual([
      'drop table if exists public.monitoring_results',
      'drop table if exists public.monitoring_limits',
      'alter table if exists public.stormwater_outfalls drop constraint if exists stormwater_outfalls_tenant_facility_id_key',
    ])
  })

  it('leaves the outfalls, the permit vault and everything EMS owns alone', () => {
    expect(rollback).not.toMatch(/drop table (if exists )?public\.stormwater_outfalls\b/)
    expect(rollback).not.toMatch(/delete from|truncate/i)
    expect(rollback).not.toMatch(/environmental_permits/)
    expect(rollback).not.toMatch(/\b(ems_|ms_)|compliance_calendar|legal_register|inspection/)
  })
})
