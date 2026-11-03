import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 305 closes five privilege gaps found in the November 2026 audit.
// Migration-TEXT assertions, in the style of profilesPrivilegedColumns.test.ts:
// the unit suite has no database, so these prove the migration says what it
// must, not that Postgres enforces it. The behavioural proof is the PR body:
// the same migration was applied to a scratch Postgres 16 and 14 exploit
// attempts (blocked) plus 15 legitimate operations (still working) were run
// as anon, authenticated and service_role.

const MIGRATIONS = resolve(__dirname, '../../migrations')
const read = (name: string) => readFileSync(resolve(MIGRATIONS, name), 'utf8')
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const sql = stripComments(read('305_security_privilege_guards.sql'))
const rollback = stripComments(read('305_rollback.sql'))

const UPDATE_MANUAL_SIGNATURE =
  'public.update_manual( text, text, text, boolean, text, timestamptz, boolean, uuid, text )'

describe('Migration 305 — privilege guards', () => {
  it('removes update_manual() from anon and authenticated and keeps it for the service role', () => {
    expect(sql).toContain(`revoke all on function ${UPDATE_MANUAL_SIGNATURE} from public, anon, authenticated`)
    expect(sql).toContain(`grant execute on function ${UPDATE_MANUAL_SIGNATURE} to service_role`)
  })

  it('turns on row-level security for the finding counter and strips client grants', () => {
    expect(sql).toContain('alter table public.hazard_hunt_finding_sequences enable row level security')
    expect(sql).toContain('revoke all on public.hazard_hunt_finding_sequences from anon, authenticated')
  })

  it('reserves every change to or from the owner role for owners and superadmins', () => {
    expect(sql).toContain('before insert or update or delete on public.tenant_memberships')
    expect(sql).toContain('public.current_user_owner_tenant_ids()')
    expect(sql).toContain('public.is_superadmin()')
    for (const op of [
      "tg_op = 'INSERT' and new.role = 'owner'",
      "old.role = 'owner' or new.role = 'owner'",
      "tg_op = 'DELETE' and old.role = 'owner'",
    ]) {
      expect(sql).toContain(op)
    }
  })

  it('forbids moving a membership to another user or tenant', () => {
    expect(sql).toContain('new.user_id is distinct from old.user_id')
    expect(sql).toContain('new.tenant_id is distinct from old.tenant_id')
  })

  it('locks the commercial and lifecycle tenant columns but not name, logo, language or settings', () => {
    expect(sql).toContain('before update on public.tenants')
    const guarded = /c_guarded constant text\[\] := array\[([^\]]+)\]/.exec(sql)?.[1] ?? ''
    for (const column of ['tenant_number', 'slug', 'status', 'is_demo', 'disabled_at', 'modules', 'custom_domain']) {
      expect(guarded).toContain(`'${column}'`)
    }
    for (const column of ['name', 'logo_url', 'language', 'settings']) {
      expect(guarded).not.toContain(`'${column}'`)
    }
  })

  it('acts only on end-user JWTs so the service-role client keeps working', () => {
    const guards = sql.match(/not in \('authenticated', 'anon'\)/g) ?? []
    expect(guards).toHaveLength(2)
  })

  it('makes CMMS integrations tenant-admin only', () => {
    expect(sql).toContain('drop policy if exists "cmms_integrations_tenant_scope"')
    expect(sql).toMatch(/create policy "cmms_integrations_admin" on public\.cmms_integrations for all to authenticated using \( tenant_id in \(select public\.current_user_admin_tenant_ids\(\)\)/)
    expect(sql).not.toContain('create policy "cmms_integrations_tenant_scope"')
  })

  it('is re-runnable', () => {
    expect(sql).toContain('drop trigger if exists trg_tenants_guard_privileged_columns')
    expect(sql).toContain('drop trigger if exists trg_tenant_memberships_guard_owner_role')
    expect(sql).toContain('drop policy if exists "cmms_integrations_admin"')
    expect(sql).toMatch(/^begin;.*commit;$/)
  })

  it('has a rollback that restores each gap', () => {
    expect(rollback).toContain('drop trigger if exists trg_tenants_guard_privileged_columns')
    expect(rollback).toContain('drop trigger if exists trg_tenant_memberships_guard_owner_role')
    expect(rollback).toContain('create policy "cmms_integrations_tenant_scope"')
    expect(rollback).toContain('alter table public.hazard_hunt_finding_sequences disable row level security')
    expect(rollback).toContain(`grant execute on function ${UPDATE_MANUAL_SIGNATURE} to anon, authenticated`)
  })
})
