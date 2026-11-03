import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 306 moves two secrets out of tables every logged-in user can read:
// loto_org_config.push_dispatch_secret (which equals INTERNAL_PUSH_SECRET and
// authenticates every cron route) and tenants.settings.anthropic_api_key.
//
// Migration-TEXT assertions, in the style of securityPrivilegeGuards.test.ts.
// The behavioural proof is the PR body: the migration was applied to a scratch
// Postgres 16 and checked as member, viewer, anon, tenant owner, platform admin
// and service_role, including a second run that must not clobber rotated values.

const sql = readFileSync(
  resolve(__dirname, '../../migrations/306_move_secrets_out_of_client_readable_tables.sql'),
  'utf8',
)
const code = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

describe('Migration 306 — secrets out of client-readable tables', () => {
  it.each(['loto_org_secrets', 'tenant_secrets'])(
    'makes %s unreadable to every client role',
    table => {
      expect(code).toContain(`alter table public.${table} enable row level security`)
      expect(code).toContain(`revoke all on public.${table} from anon, authenticated`)
      // RLS with no policies is the deny-by-default the service role bypasses.
      expect(code).not.toMatch(new RegExp(`create policy [^;]* on public\\.${table}\\b`))
    },
  )

  it('copies the push secret before dropping the column, and only while the column exists', () => {
    const copy = code.indexOf('insert into public.loto_org_secrets')
    const drop = code.indexOf('alter table public.loto_org_config drop column if exists push_dispatch_secret')
    expect(copy).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(copy)
    expect(code).toContain("column_name = 'push_dispatch_secret'")
  })

  it('has emit_push read the secret from loto_org_secrets, not loto_org_config', () => {
    const fn = /create or replace function public\.emit_push.*?end \$\$;/.exec(code)?.[0] ?? ''
    expect(fn).toContain('join public.loto_org_secrets')
    expect(fn).not.toMatch(/c\.push_dispatch_secret/)
    expect(fn).toContain("'X-Internal-Secret', v_secret")
    expect(fn).toContain('security definer')
  })

  it.each([
    ['set_push_dispatch_secret', '(text)'],
    ['push_dispatch_secret_configured', '()'],
  ])(
    'restricts %s to platform admins and to signed-in callers',
    (name, args) => {
      const signature = `${name}${args}`
      const fn = new RegExp(`create or replace function public\\.${name}.*?end \\$\\$;`).exec(code)?.[0] ?? ''
      expect(fn).toContain('security definer')
      expect(fn).toContain('set search_path = public, pg_temp')
      expect(fn).toContain('auth.uid() is null')
      expect(fn).toContain('is_admin')
      expect(code).toContain(`revoke all on function public.${signature} from public, anon`)
      expect(code).toContain(`grant execute on function public.${signature} to authenticated`)
    },
  )

  it('moves the tenant key trimmed, skips blank keys, and strips the key from settings', () => {
    expect(code).toContain("btrim(settings ->> 'anthropic_api_key')")
    expect(code).toContain("btrim(coalesce(settings ->> 'anthropic_api_key', '')) <> ''")
    expect(code).toContain("set settings = settings - 'anthropic_api_key' where settings ? 'anthropic_api_key'")
  })

  it('is re-runnable without overwriting a rotated value', () => {
    expect(code).toContain('create table if not exists public.loto_org_secrets')
    expect(code).toContain('create table if not exists public.tenant_secrets')
    // The tenant copy keys off settings, which the first run empties of the key.
    expect(code).toMatch(/^begin;.*commit;$/)
  })

  it('ships without a rollback because reverting would re-expose the secrets', () => {
    expect(sql).toContain('DEPLOY WITH THE MATCHING APP RELEASE')
    expect(sql).toContain('must be treated as compromised')
  })
})
