-- Minimal Supabase-shaped fixture for the platform service test database.
--
-- Mirrors ONLY what the platform service depends on: the `authenticated`
-- role, auth.uid(), the header-scoping helper from migration 032, the
-- tenant-scope RLS policy shape from migrations 029/032, and the columns the
-- unmanaged models map. The real migration 294 is applied on top of this by
-- tests/conftest.py, so the platform_svc grants and policies under test are
-- the ones that ship.
--
-- Idempotent: roles are cluster-global and survive test-database recreation.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create table if not exists public.tenants (
  id uuid primary key, tenant_number text unique, slug text unique not null,
  name text not null, status text not null default 'active',
  is_demo boolean not null default false, disabled_at timestamptz,
  modules jsonb not null default '{}', settings jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id), email text unique not null,
  full_name text, is_superadmin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_memberships (
  user_id uuid not null references auth.users(id),
  tenant_id uuid not null references public.tenants(id),
  role text not null default 'member', invite_cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table if not exists public.facilities (
  id uuid primary key, tenant_id uuid not null references public.tenants(id),
  name text not null, code text, is_primary boolean not null default false,
  status text not null default 'active', created_at timestamptz not null default now()
);

create table if not exists public.ai_invocations (
  id bigserial primary key, user_id uuid not null, tenant_id uuid references public.tenants(id),
  surface text not null, model text not null, status text not null,
  input_tokens int, output_tokens int, cache_read_tokens int, cache_write_tokens int,
  occurred_at timestamptz not null default now()
);

create table if not exists public.cron_runs (
  id bigserial primary key, cron_path text not null, started_at timestamptz not null default now(),
  ended_at timestamptz, status text default 'running', summary text,
  trigger text not null default 'scheduled'
);

-- A domain table platform_svc is deliberately NOT granted, to prove that
-- membership in `authenticated` does not leak authenticated's privileges.
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id), title text not null
);

create or replace function public.active_tenant_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(coalesce(current_setting('request.headers', true), '')::jsonb ->> 'x-active-tenant', '')::uuid
$$;

create or replace function public.current_user_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select tenant_id from public.tenant_memberships
   where user_id = auth.uid() and invite_cancelled_at is null
$$;

create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
$$;

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

do $$
declare t text;
begin
  foreach t in array array['facilities', 'ai_invocations', 'incidents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_scope', t);
    execute format($pol$
      create policy %I on public.%I for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        )
    $pol$, t || '_tenant_scope', t);
  end loop;
end
$$;

alter table public.tenants enable row level security;
drop policy if exists tenants_member_read on public.tenants;
create policy tenants_member_read on public.tenants for select to authenticated
  using (id in (select public.current_user_tenant_ids()) or public.is_superadmin());

-- Seed: two tenants, a member of tenant A, and a superadmin with no memberships.
insert into public.tenants (id, tenant_number, slug, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '0001', 'tenant-a', 'Tenant A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '0002', 'tenant-b', 'Tenant B')
on conflict do nothing;

insert into auth.users (id) values
  ('11111111-0000-0000-0000-00000000a11c'),
  ('22222222-0000-0000-0000-000000000b0b')
on conflict do nothing;

insert into public.profiles (id, email, is_superadmin) values
  ('11111111-0000-0000-0000-00000000a11c', 'alice@tenant-a.test', false),
  ('22222222-0000-0000-0000-000000000b0b', 'bob@soteria.test', true)
on conflict do nothing;

insert into public.tenant_memberships (user_id, tenant_id, role) values
  ('11111111-0000-0000-0000-00000000a11c', 'aaaaaaaa-0000-0000-0000-000000000001', 'member')
on conflict do nothing;

insert into public.facilities (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'A Plant 1'),
  ('aaaaaaaa-0000-0000-0000-0000000000f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'A Plant 2'),
  ('bbbbbbbb-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000002', 'B Plant 1')
on conflict do nothing;

insert into public.incidents (tenant_id, title)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'A incident'
where not exists (select 1 from public.incidents);
