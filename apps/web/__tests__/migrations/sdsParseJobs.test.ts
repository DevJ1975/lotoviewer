import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 294 adds the background SDS parse queue drained by the parser
// service (services/sds-parser/app/jobs.py).
//
// These are migration-TEXT assertions, in the same style as the other files in
// this folder: there is no database in the unit suite, so they prove the
// migration says what it must — not that Postgres enforces it. The behavioural
// proof (SKIP LOCKED under two concurrent claims, lease takeover, the
// final-attempt cutoff, fencing, RLS) was run against Postgres 16 and is
// recorded in the PR that added this migration.

const REPO_APPS_WEB = resolve(__dirname, '../..')
const read = (file: string) => readFileSync(resolve(REPO_APPS_WEB, 'migrations', file), 'utf8')
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const sql      = stripComments(read('294_sds_parse_jobs.sql'))
const rollback = stripComments(read('294_rollback.sql'))

describe('Migration 294 — background SDS parse jobs', () => {
  it('enables RLS and grants tenant members read access only', () => {
    expect(sql).toContain('alter table public.sds_parse_jobs enable row level security')
    expect(sql).toMatch(/create policy sds_parse_jobs_tenant_read on public\.sds_parse_jobs for select to authenticated/)
    // No write policy: only the service role (which bypasses RLS) may
    // enqueue, claim or finish, so a browser session cannot forge a result.
    expect(sql).not.toMatch(/for (all|insert|update|delete) to authenticated/)
  })

  it('scopes the read policy to the active tenant and the caller’s memberships', () => {
    expect(sql).toContain('public.active_tenant_id() is null or tenant_id = public.active_tenant_id()')
    expect(sql).toContain('tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin()')
  })

  it('allows at most one live job per SDS', () => {
    expect(sql).toMatch(
      /create unique index if not exists sds_parse_jobs_one_live_per_sds on public\.sds_parse_jobs \(sds_id\) where status in \('queued','running'\)/,
    )
  })

  it('claims with SKIP LOCKED inside a pinned-search-path security definer', () => {
    expect(sql).toContain('create or replace function public.claim_sds_parse_job(p_lease_seconds int, p_max_attempts int)')
    expect(sql).toContain('security definer set search_path = pg_catalog, public')
    expect(sql).toContain('for update skip locked')
  })

  it('lets only the service role call the claim function', () => {
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(sql).toContain(`revoke all on function public.claim_sds_parse_job(int, int) from ${role}`)
    }
    expect(sql).toContain('grant execute on function public.claim_sds_parse_job(int, int) to service_role')
  })

  it('rolls back cleanly', () => {
    expect(rollback).toContain('drop function if exists public.claim_sds_parse_job(int, int)')
    expect(rollback).toContain('drop table if exists public.sds_parse_jobs')
  })
})
