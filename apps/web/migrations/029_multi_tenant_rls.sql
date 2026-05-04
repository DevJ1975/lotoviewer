-- Migration 029: lockdown — NOT NULL + tenant-scoped RLS
--
-- Phase 3 of the multi-tenant rollout. THE RISKY ONE.
--
-- A typo in any RLS USING clause makes every read return zero rows for
-- every non-superadmin user. After applying:
--   1. Reload the app as your normal (non-superadmin) account
--   2. Verify the dashboard, equipment list, and at least one detail page
--      still show data
--   3. If reads are empty, run migrations/029_rollback.sql immediately
--
-- What this migration does:
--   1. Adds current_user_tenant_ids() — returns the caller's tenant_ids
--   2. Adds is_superadmin() — true iff profiles.is_superadmin = true
--      Note: app code MUST also enforce SUPERADMIN_EMAILS env allowlist;
--      this DB function alone is not the security boundary
--   3. Sets tenant_id NOT NULL on every domain table (except audit_log)
--   4. Drops the legacy *_authenticated_all policies
--   5. Creates *_tenant_scope policies on every domain table:
--        using (tenant_id in (select current_user_tenant_ids())
--               or is_superadmin())
--   6. Tightens RLS on tenants and tenant_memberships
--
-- Pre-flight: migrations 027 + 028 must already be applied. The verify
-- block at the start of this migration aborts if any domain table still
-- has tenant_id IS NULL.
--
-- Idempotent: re-runs are safe (drops policies before recreating, uses
-- alter column ... set not null which is a no-op if already NOT NULL).
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight verification — abort if backfill is incomplete
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t            text;
  cnt          bigint;
  total_null   bigint := 0;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    execute format('select count(*) from public.%I where tenant_id is null', t)
      into cnt;
    if cnt > 0 then
      raise notice 'BLOCK: % has % rows with tenant_id IS NULL', t, cnt;
      total_null := total_null + cnt;
    end if;
  end loop;

  if total_null > 0 then
    raise exception 'Cannot lock down: % rows with tenant_id IS NULL across domain tables. Run migration 028 first.', total_null;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Helper: current_user_tenant_ids()
--
-- Returns the tenant_ids the caller belongs to. Excludes disabled tenants.
-- SECURITY DEFINER so it can read tenant_memberships even when RLS on that
-- table would otherwise block recursion. Search_path is locked.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.tenant_id
    from public.tenant_memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = auth.uid()
     and t.disabled_at is null
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Helper: is_superadmin()
--
-- True iff the caller is flagged as superadmin in profiles. App code MUST
-- additionally check SUPERADMIN_EMAILS env allowlist via requireSuperadmin()
-- before invoking any superadmin-only endpoint — this function alone is not
-- the security boundary.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select is_superadmin from public.profiles where id = auth.uid()),
    false
  )
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Set tenant_id NOT NULL on every domain table that has the column
--
-- Loops over information_schema so we don't have to maintain the table list
-- in sync with 027. Excludes audit_log (stays nullable forever) and
-- tenants/tenant_memberships (their tenant_id is identity, not a constraint).
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    execute format('alter table public.%I alter column tenant_id set not null', t);
    raise notice 'tenant_id NOT NULL set on %', t;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Domain table policies — drop existing, create tenant-scoped
--
-- The old policies were named "<table>_authenticated_all". We drop ALL
-- policies on each table to be safe (some migrations may have added extra
-- policies under different names), then create exactly one tenant_scope
-- policy that allows full CRUD scoped to the caller's tenant memberships
-- OR superadmin.
--
-- Storage RLS for the loto-photos bucket is handled in a later migration
-- (031); we don't touch storage.objects here.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t        text;
  pol      text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    -- Drop every existing policy on this table.
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol, t);
    end loop;

    -- Make sure RLS is on (some tables may have been created before 003).
    execute format('alter table public.%I enable row level security', t);

    -- Create the single tenant_scope policy.
    execute format($pol$
      create policy %I on public.%I
        for all to authenticated
        using (
          tenant_id in (select public.current_user_tenant_ids())
          or public.is_superadmin()
        )
        with check (
          tenant_id in (select public.current_user_tenant_ids())
          or public.is_superadmin()
        )
    $pol$, t || '_tenant_scope', t);

    raise notice 'tenant_scope policy installed on %', t;
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. audit_log — special policies
--
-- Reads: members of a tenant can see their tenant's audit rows; superadmin
--        sees everything (including the NULL-tenant rows from cross-tenant
--        admin actions).
-- Writes: handled by log_audit() trigger, which runs as SECURITY DEFINER.
--         No INSERT policy needed for app code.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare pol text;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'audit_log'
  loop
    execute format('drop policy if exists %I on public.audit_log', pol);
  end loop;
end $$;

alter table public.audit_log enable row level security;

create policy "audit_log_tenant_or_superadmin_read" on public.audit_log
  for select to authenticated
  using (
    public.is_superadmin()
    or (tenant_id is not null and tenant_id in (select public.current_user_tenant_ids()))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. tenants — replace permissive policies with member-read + superadmin-write
--
-- Reads:  members can see tenants they belong to; superadmins see all.
-- Writes: superadmin only. Tenant owners get write access through a separate
--         policy below so they can update their own tenant's name, logo, etc.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare pol text;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'tenants'
  loop
    execute format('drop policy if exists %I on public.tenants', pol);
  end loop;
end $$;

create policy "tenants_member_read" on public.tenants
  for select to authenticated
  using (
    public.is_superadmin()
    or id in (select public.current_user_tenant_ids())
  );

create policy "tenants_superadmin_write" on public.tenants
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

create policy "tenants_owner_update" on public.tenants
  for update to authenticated
  using (
    id in (
      select m.tenant_id from public.tenant_memberships m
       where m.user_id = auth.uid() and m.role = 'owner'
    )
  )
  with check (
    id in (
      select m.tenant_id from public.tenant_memberships m
       where m.user_id = auth.uid() and m.role = 'owner'
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 7. tenant_memberships — replace permissive policies
--
-- Reads:  user can see their own memberships; owners/admins of a tenant can
--         see all memberships in their tenant; superadmin sees all.
-- Writes: owners/admins of a tenant can invite/remove members; superadmin
--         can do anything.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare pol text;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'tenant_memberships'
  loop
    execute format('drop policy if exists %I on public.tenant_memberships', pol);
  end loop;
end $$;

create policy "memberships_self_read" on public.tenant_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_superadmin());

create policy "memberships_tenant_admin_read" on public.tenant_memberships
  for select to authenticated
  using (
    tenant_id in (
      select m.tenant_id from public.tenant_memberships m
       where m.user_id = auth.uid() and m.role in ('owner', 'admin')
    )
  );

create policy "memberships_tenant_admin_write" on public.tenant_memberships
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (
      select m.tenant_id from public.tenant_memberships m
       where m.user_id = auth.uid() and m.role in ('owner', 'admin')
    )
  )
  with check (
    public.is_superadmin()
    or tenant_id in (
      select m.tenant_id from public.tenant_memberships m
       where m.user_id = auth.uid() and m.role in ('owner', 'admin')
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Reload PostgREST schema cache so the new functions are callable
-- ────────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

commit;

-- ────────────────────────────────────────────────────────────────────────────
-- POST-MIGRATION VERIFICATION (run AS A NORMAL USER, not as postgres)
--
-- The SQL Editor runs as the postgres role which bypasses RLS — these
-- queries will look correct from there even if RLS is broken. Real
-- verification means loading the app:
--   1. Open the app, log in as a Snak King member (not superadmin)
--   2. Dashboard should show all 954 equipment rows
--   3. Open one equipment detail page — should load
--   4. Open /admin/audit — should show recent rows
--
-- If any of those return empty, run migrations/029_rollback.sql IMMEDIATELY.
-- ────────────────────────────────────────────────────────────────────────────
