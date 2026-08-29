import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 249 closes a privilege-escalation path: RLS UPDATE policies are
// row-scoped, so profiles_self_update (003) and profiles_visible_write (054)
// also permitted writing is_admin / is_superadmin. A BEFORE UPDATE trigger
// supplies the missing column scope.
//
// These are migration-TEXT assertions, in the same style as
// __tests__/migrations/sdsLibrary.test.ts. There is no database in the unit
// suite, so they prove the migration says what it must — NOT that Postgres
// enforces it. The behavioural proof is the staging checklist in the PR body:
// apply to a Supabase branch, then confirm a normal user's
// `update({ is_superadmin: true })` fails while `update({ full_name })`
// succeeds.

const REPO_APPS_WEB = resolve(__dirname, '../..')

const sql = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/249_profiles_privileged_columns.sql'),
  'utf8',
)
const rollback = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/249_rollback.sql'),
  'utf8',
)

// The header comment necessarily names the guarded columns and quotes the
// exploit, so every structural assertion runs against comment-stripped SQL.
const sqlNoComments = sql.replace(/--[^\n]*/g, '').replace(/\n{2,}/g, '\n').trim()

const PRIVILEGED_COLUMNS = ['id', 'email', 'is_admin', 'is_superadmin'] as const
const SELF_SERVICE_COLUMNS = [
  'full_name',
  'must_change_password',
  'avatar_url',
  'onboarding_completed_at',
] as const

describe('Migration 249 — privileged profile columns', () => {
  it('fires before every profiles UPDATE', () => {
    expect(sqlNoComments).toContain('before update on public.profiles')
    expect(sqlNoComments).toContain('for each row')
    expect(sqlNoComments).toContain(
      'execute function public.profiles_guard_privileged_columns()',
    )
  })

  it('guards each privileged column against change', () => {
    for (const column of PRIVILEGED_COLUMNS) {
      expect(sqlNoComments).toMatch(
        new RegExp(`new\\.${column}\\s+is distinct from\\s+old\\.${column}`),
      )
    }
  })

  it('leaves the self-service columns writable', () => {
    // The reset-password and onboarding flows write these straight from the
    // browser. Guarding them would break a shipped path.
    for (const column of SELF_SERVICE_COLUMNS) {
      expect(sqlNoComments).not.toContain(`new.${column}`)
    }
  })

  it('rejects with insufficient_privilege rather than a generic error', () => {
    expect(sqlNoComments).toContain('raise exception')
    expect(sqlNoComments).toContain("errcode = 'insufficient_privilege'")
  })

  it('exempts service_role and postgres so admin routes still work', () => {
    // Only end-user PostgREST roles are blocked; supabaseAdmin (service_role)
    // and migrations (postgres) carry no such claim and must pass through.
    expect(sqlNoComments).toContain("not in ('authenticated', 'anon')")
    expect(sqlNoComments).toContain('return new')
  })

  it('reads the JWT claim without tripping over an empty GUC', () => {
    // PostgREST sets request.jwt.claims to '' when unauthenticated, and
    // ''::jsonb raises instead of yielding null — nullif is load-bearing.
    expect(sqlNoComments).toContain(
      "nullif(current_setting('request.jwt.claims', true), '')::jsonb",
    )
  })

  it('pins search_path on the trigger function', () => {
    expect(sqlNoComments).toContain('set search_path = public, pg_temp')
  })

  it('is idempotent and transactional', () => {
    expect(sqlNoComments).toContain(
      'create or replace function public.profiles_guard_privileged_columns()',
    )
    expect(sqlNoComments).toContain(
      'drop trigger if exists trg_profiles_guard_privileged_columns on public.profiles',
    )
    expect(sqlNoComments.startsWith('begin;')).toBe(true)
    expect(sqlNoComments.endsWith('commit;')).toBe(true)
    expect(sqlNoComments).toContain("notify pgrst, 'reload schema'")
  })

  it('drops profiles_visible_write, which admitted any co-tenant', () => {
    // 054's predicate resolves to "anyone sharing a tenant with the caller"
    // despite the policy's admin-write framing. Every real profile write is
    // either self-scoped or service-role, so it has no legitimate consumer.
    expect(sqlNoComments).toContain(
      'drop policy if exists "profiles_visible_write" on public.profiles',
    )
  })

  it('ships a rollback that restores both the trigger and the policy', () => {
    expect(rollback).toContain('create policy "profiles_visible_write" on public.profiles')
    expect(rollback).toContain(
      'drop trigger if exists trg_profiles_guard_privileged_columns on public.profiles',
    )
    expect(rollback).toContain(
      'drop function if exists public.profiles_guard_privileged_columns()',
    )
  })
})
