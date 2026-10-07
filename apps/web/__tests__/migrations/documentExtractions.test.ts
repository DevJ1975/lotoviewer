import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 296 adds the staging table for the environmental document reader:
// an uploaded permit / manifest / SWPPP is read by the Python service and held
// here as a PROPOSAL until a tenant admin approves it.
//
// Migration-TEXT assertions, as in serviceJobs.test.ts: there is no database in
// the unit suite. The behavioural proof (constraints, the decision/timestamp
// pairing, RLS as a member, service-role writes, cascades) was run against
// Postgres 16 and is recorded in the PR that added this migration.

const REPO_APPS_WEB = resolve(__dirname, '../..')
const read = (file: string) => readFileSync(resolve(REPO_APPS_WEB, 'migrations', file), 'utf8')
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const sql      = stripComments(read('296_document_extractions.sql'))
const rollback = stripComments(read('296_rollback.sql'))

describe('Migration 296 — document extractions', () => {
  it('is read-only to browsers: RLS on, a select policy, and no authenticated write policy', () => {
    expect(sql).toContain('alter table public.document_extractions enable row level security')
    expect(sql).toMatch(/create policy document_extractions_read on public\.document_extractions for select to authenticated/)
    // Writes go through role-checked API routes and the service, so a browser
    // session cannot forge a proposal or a decision.
    expect(sql).not.toMatch(/for (all|insert|update|delete) to authenticated/)
  })

  it('scopes reads to the tenant, then to the active facility (migration 211 semantics)', () => {
    expect(sql).toContain('public.active_tenant_id() is null or tenant_id = public.active_tenant_id()')
    expect(sql).toContain('tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin()')
    expect(sql).toContain('public.active_facility_id() is null or facility_id = public.active_facility_id()')
  })

  it('requires a facility and a tenant on every document', () => {
    expect(sql).toMatch(/tenant_id uuid not null references public\.tenants\(id\) on delete cascade/)
    expect(sql).toMatch(/facility_id uuid not null references public\.facilities\(id\) on delete cascade/)
  })

  it("forces the object path to start with the row's own tenant", () => {
    expect(sql).toContain("check (storage_path like (tenant_id::text || '/%'))")
    expect(sql).toContain('unique (storage_path)')
  })

  it('allows only the five lifecycle states', () => {
    expect(sql).toContain("check (status in ('processing','needs_review','approved','rejected','failed'))")
  })

  it('gives a decision a timestamp, and nothing else', () => {
    expect(sql).toContain("check ((status in ('approved','rejected')) = (reviewed_at is not null))")
  })

  it('bounds the stored proposal and types the reviewer-confirmed fields', () => {
    expect(sql).toContain("jsonb_typeof(extraction) = 'object'")
    expect(sql).toContain('octet_length(extraction::text) <= 262144')
    expect(sql).toContain("check (jsonb_typeof(reviewed_fields) = 'array')")
    expect(sql).toContain('check (error is null or length(error) <= 1000)')
  })

  it('keeps the document when its job is purged', () => {
    expect(sql).toMatch(/job_id uuid references public\.service_jobs\(id\) on delete set null/)
  })

  it('audits changes and maintains updated_at', () => {
    expect(sql).toContain('execute function public.touch_updated_at()')
    expect(sql).toContain("execute function public.log_audit('id')")
  })

  it('creates a private, PDF-only bucket with NO storage policies (default-deny for browsers)', () => {
    expect(sql).toContain("'environmental-docs', 'environmental-docs', false")
    expect(sql).toContain("array['application/pdf']::text[]")
    expect(sql).not.toContain('on storage.objects')
  })

  it('rolls back the table and leaves the uploaded PDFs alone', () => {
    expect(rollback).toContain('drop table if exists public.document_extractions')
    expect(rollback).not.toMatch(/storage\.(buckets|objects)/)
  })
})
