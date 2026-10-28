// A real Postgres (PGlite, in-process WebAssembly) with just enough of the
// Supabase platform to run the repo's actual EMS migrations, then exercise
// their triggers, views and RLS as real users. The platform stand-ins below
// copy the production definitions (migrations 003, 029, 032, 190) so the
// policies under test evaluate exactly as they do in Supabase.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

export function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
}

export const IDS = {
  tenantA:   '11111111-1111-4111-8111-111111111111',   // the demo tenant WLS seeds into
  tenantB:   '22222222-2222-4222-8222-222222222222',
  ownerA:    '00000000-0000-4000-8000-0000000000a1',
  memberA:   '00000000-0000-4000-8000-0000000000a2',
  adminB:    '00000000-0000-4000-8000-0000000000b1',
} as const

// Supabase's auth, storage and default grants, reduced to what the migrations touch.
const PLATFORM_SQL = `
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), ''), '')::uuid
$$;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);

grant usage on schema public, auth, storage to authenticated, anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon;
alter default privileges in schema public grant usage, select on sequences to authenticated, anon;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, email text,
  is_superadmin boolean not null default false
);
create table public.tenants (
  id uuid primary key default gen_random_uuid(), tenant_number text unique, slug text unique not null,
  name text not null, status text not null default 'active', is_demo boolean not null default false,
  disabled_at timestamptz, modules jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tenant_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null, invite_cancelled_at timestamptz, created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create table public.audit_log (
  id bigserial primary key, actor_id uuid, actor_email text, table_name text not null,
  operation text not null, row_pk text, old_row jsonb, new_row jsonb, tenant_id uuid,
  created_at timestamptz not null default now()
);
create table public.risks (id uuid primary key default gen_random_uuid(), tenant_id uuid);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- migration 003
create or replace function public.log_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor_id uuid := auth.uid(); v_actor_email text; v_pk text; v_pk_col text := tg_argv[0];
begin
  if v_actor_id is not null then select email into v_actor_email from public.profiles where id = v_actor_id; end if;
  if tg_op = 'DELETE' then v_pk := (to_jsonb(old) ->> v_pk_col); else v_pk := (to_jsonb(new) ->> v_pk_col); end if;
  insert into public.audit_log (actor_id, actor_email, table_name, operation, row_pk, old_row, new_row)
  values (v_actor_id, v_actor_email, tg_table_name, tg_op, v_pk,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

-- migration 029
create or replace function public.is_superadmin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
$$;

-- migration 032 (300 replaces it; this is the original, so 300's fix is exercised)
create or replace function public.active_tenant_id() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(coalesce(current_setting('request.headers', true), '')::jsonb ->> 'x-active-tenant', '')::uuid
$$;

-- migration 190
create or replace function public.current_user_tenant_ids() returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.tenant_id from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid() and t.disabled_at is null and m.invite_cancelled_at is null
$$;
create or replace function public.current_user_admin_tenant_ids() returns setof uuid language sql stable security definer set search_path = public, pg_temp as $$
  select m.tenant_id from public.tenant_memberships m join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid() and m.role in ('owner','admin') and t.disabled_at is null and m.invite_cancelled_at is null
$$;
`

// Two tenants, created before migration 209 so its backfill gives each a primary facility.
const FIXTURE_SQL = `
insert into auth.users (id, email) values
  ('${IDS.ownerA}', 'owner-a@example.test'), ('${IDS.memberA}', 'member-a@example.test'), ('${IDS.adminB}', 'admin-b@example.test');
insert into public.profiles (id, email) select id, email from auth.users;
insert into public.tenants (id, tenant_number, slug, name, is_demo) values
  ('${IDS.tenantA}', '0101', 'tenant-a', 'Tenant A', true),
  ('${IDS.tenantB}', '0102', 'tenant-b', 'Tenant B', false);
insert into public.tenant_memberships (user_id, tenant_id, role) values
  ('${IDS.ownerA}', '${IDS.tenantA}', 'owner'),
  ('${IDS.memberA}', '${IDS.tenantA}', 'member'),
  ('${IDS.adminB}', '${IDS.tenantB}', 'admin');
`

/** Migrations up to Phase 0, in production order. */
export const BASE_MIGRATIONS = [
  '192_compliance_obligations.sql',
  '204_iso14001_ems.sql',
  '205_iso14001_objectives.sql',
  '206_nonconformities.sql',
  '207_management_reviews.sql',
] as const
export const FACILITY_MIGRATIONS = ['209_facilities.sql', '210_facility_id_columns.sql', '211_facility_rls_scope.sql'] as const
export const PRE_PHASE1_MIGRATIONS = ['256_wls_iso14001_demo.sql', '294_environmental_module_opt_in.sql'] as const
/** Phase 1, in apply order: 295-300 before the deploy, 301 after it. */
export const PHASE1_MIGRATIONS = [
  '295_ms_context_scope_policy.sql',
  '296_ms_scoring_methods.sql',
  '297_environmental_aspects_register.sql',
  '298_compliance_obligations_register.sql',
  '299_ms_evidence.sql',
  '300_ems_facility_scope.sql',
  '301_environmental_aspects_contract.sql',
] as const

/** A fresh database with the platform, two tenants, and every migration through Phase 1 applied. */
export async function createEmsDatabase(options: { throughPhase1?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(PLATFORM_SQL)
  for (const file of BASE_MIGRATIONS) await db.exec(migrationSql(file))
  await db.exec(FIXTURE_SQL)
  for (const file of [...FACILITY_MIGRATIONS, ...PRE_PHASE1_MIGRATIONS]) await db.exec(migrationSql(file))
  if (options.throughPhase1 !== false) {
    for (const file of PHASE1_MIGRATIONS) await db.exec(migrationSql(file))
  }
  return db
}

export interface Caller {
  userId: string
  tenantId?: string
  facilityId?: string
}

/**
 * Run `work` as an authenticated PostgREST caller: role `authenticated`,
 * the caller's JWT subject, and the x-active-* headers. RLS applies.
 */
export async function asCaller<T>(db: PGlite, caller: Caller, work: () => Promise<T>): Promise<T> {
  const headers: Record<string, string> = {}
  if (caller.tenantId) headers['x-active-tenant'] = caller.tenantId
  if (caller.facilityId) headers['x-active-facility'] = caller.facilityId
  await db.query(
    `select set_config('request.jwt.claim.sub', $1, false), set_config('request.headers', $2, false)`,
    [caller.userId, JSON.stringify(headers)],
  )
  await db.exec('set role authenticated')
  try {
    return await work()
  } finally {
    await db.exec('reset role')
    await db.exec(`select set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '', false)`)
  }
}

/** The first row's first column, or null. */
export async function scalar<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await db.query<Record<string, T>>(sql, params)
  const row = result.rows[0]
  return row ? (Object.values(row)[0] as T) : null
}
