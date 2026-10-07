import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 295 adds the generic job queue drained by the Python service
// (services/sds-parser/app/service_jobs.py): document reading, regulation
// loading and history imports all run as `kind`s on it.
//
// These are migration-TEXT assertions, in the same style as sdsParseJobs.test.ts:
// there is no database in the unit suite, so they prove the migration says what
// it must — not that Postgres enforces it. The behavioural proof (kind
// filtering, SKIP LOCKED, dedupe including platform jobs, per-job attempt
// limits, heartbeats, size limits, RLS) was run against Postgres 16 and is
// recorded in the PR that added this migration.

const REPO_APPS_WEB = resolve(__dirname, '../..')
const read = (file: string) => readFileSync(resolve(REPO_APPS_WEB, 'migrations', file), 'utf8')
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const sql      = stripComments(read('295_service_jobs.sql'))
const rollback = stripComments(read('295_rollback.sql'))

describe('Migration 295 — generic service jobs', () => {
  it('enables RLS with a read-only policy and no authenticated write policy', () => {
    expect(sql).toContain('alter table public.service_jobs enable row level security')
    expect(sql).toMatch(/create policy service_jobs_read on public\.service_jobs for select to authenticated/)
    // Only the service role (which bypasses RLS) may enqueue, claim, extend or
    // finish, so a browser session cannot forge a result.
    expect(sql).not.toMatch(/for (all|insert|update|delete) to authenticated/)
  })

  it('shows platform jobs (no tenant) to superadmins only, and tenant jobs to members', () => {
    expect(sql).toContain('tenant_id is null and public.is_superadmin()')
    expect(sql).toContain('tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin()')
    expect(sql).toContain('public.active_tenant_id() is null or tenant_id = public.active_tenant_id()')
  })

  it('allows a platform-level job: tenant_id is nullable', () => {
    expect(sql).toMatch(/tenant_id uuid references public\.tenants\(id\) on delete cascade,/)
    expect(sql).not.toMatch(/tenant_id uuid not null/)
  })

  it('constrains the shape of a kind and the size of payload and result', () => {
    expect(sql).toContain("check (kind ~ '^[a-z][a-z0-9_]{1,63}$')")
    expect(sql).toContain('octet_length(payload::text) <= 65536')
    expect(sql).toContain('octet_length(result::text) <= 262144')
  })

  it('allows at most one live job per kind, tenant (null-safe) and dedupe key', () => {
    expect(sql).toMatch(
      /create unique index if not exists service_jobs_one_live_per_key on public\.service_jobs \(kind, coalesce\(tenant_id, '0{8}-0{4}-0{4}-0{4}-0{12}'::uuid\), dedupe_key\) where dedupe_key is not null and status in \('queued','running'\)/,
    )
  })

  it('claims with SKIP LOCKED, only the requested kinds, inside a pinned-search-path security definer', () => {
    expect(sql).toContain('create or replace function public.claim_service_job(p_kinds text[], p_lease_seconds int)')
    expect(sql).toContain('c.kind = any(p_kinds)')
    expect(sql).toContain('for update skip locked')
    expect(sql).toContain('security definer set search_path = pg_catalog, public')
  })

  it("judges the final attempt by the job's own max_attempts", () => {
    expect(sql).toContain('attempts >= max_attempts')
  })

  it('fences a heartbeat by status and attempt, so a stale worker cannot extend a taken-over job', () => {
    expect(sql).toContain('create or replace function public.heartbeat_service_job(')
    expect(sql).toContain("where id = p_id and status = 'running' and attempts = p_attempts")
  })

  it('lets only the service role call either function', () => {
    for (const fn of ['claim_service_job(text[], int)', 'heartbeat_service_job(uuid, int, int, jsonb)']) {
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(sql).toContain(`revoke all on function public.${fn} from ${role}`)
      }
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`)
    }
  })

  it('rolls back cleanly', () => {
    expect(rollback).toContain('drop function if exists public.heartbeat_service_job(uuid, int, int, jsonb)')
    expect(rollback).toContain('drop function if exists public.claim_service_job(text[], int)')
    expect(rollback).toContain('drop table if exists public.service_jobs')
  })
})
