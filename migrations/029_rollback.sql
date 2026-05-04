-- Rollback for migration 029
--
-- Use this ONLY if the lockdown migration broke reads in the app. Restores
-- the permissive *_authenticated_all policies and drops the NOT NULL
-- constraint on tenant_id so behavior matches the post-028 state.
--
-- Does NOT drop tenant_id columns or delete tenants/memberships data —
-- that data is still valid; we only revert the access controls.
--
-- Apply: paste into SQL Editor and Run. Reload the app and verify reads
-- work, then debug the failed RLS in 029 before re-applying.
-- ────────────────────────────────────────────────────────────────────────────

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Drop tenant-scoped policies on every domain table and recreate the
--    permissive authenticated_all policy that existed before 029.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t   text;
  pol text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    -- Drop every policy on this table.
    for pol in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', pol, t);
    end loop;

    -- Restore the permissive policy.
    execute format($pol$
      create policy %I on public.%I
        for all
        using (auth.uid() is not null)
        with check (auth.uid() is not null)
    $pol$, t || '_authenticated_all', t);

    -- Drop NOT NULL so anyone can write rows again without a tenant_id.
    execute format('alter table public.%I alter column tenant_id drop not null', t);
  end loop;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. audit_log — revert to admin-only read (matches migration 003)
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

create policy "audit_log_admin_read" on public.audit_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. tenants + tenant_memberships — revert to permissive
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

  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'tenant_memberships'
  loop
    execute format('drop policy if exists %I on public.tenant_memberships', pol);
  end loop;
end $$;

create policy "tenants_authenticated_all" on public.tenants
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "tenant_memberships_authenticated_all" on public.tenant_memberships
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Drop the helper functions added by 029
--    (Safe to keep them — they're inert without policies that call them —
--    but remove for cleanliness so a future re-apply of 029 starts fresh.)
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.current_user_tenant_ids();
drop function if exists public.is_superadmin();

notify pgrst, 'reload schema';

commit;
