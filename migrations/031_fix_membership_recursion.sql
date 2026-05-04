-- Migration 031: Fix RLS recursion on tenant_memberships
--
-- Migration 029 introduced policies on tenant_memberships whose USING /
-- WITH CHECK clauses contained subqueries against tenant_memberships
-- itself:
--
--     create policy "memberships_tenant_admin_read"
--       using (tenant_id in (
--         select m.tenant_id from public.tenant_memberships m
--          where m.user_id = auth.uid() and m.role in ('owner','admin')
--       ))
--
-- When Supabase reads tenants with an embedded `tenant_memberships(count)`
-- join (the superadmin tenants list does this), the inner subquery is
-- itself a select on tenant_memberships, which triggers the same policy
-- recursively. Postgres detects the cycle and raises:
--   "infinite recursion detected in policy for relation
--    \"tenant_memberships\""
--
-- Fix: wrap the subquery in a SECURITY DEFINER function. SECURITY DEFINER
-- runs with the function-owner's privileges and bypasses RLS, so the
-- subquery doesn't re-enter the policy.

begin;

-- Helper: tenant_ids where the caller has owner OR admin role.
-- Mirrors current_user_tenant_ids() but filters by role.
create or replace function public.current_user_admin_tenant_ids()
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
     and m.role in ('owner', 'admin')
     and t.disabled_at is null
$$;

-- ── tenant_memberships: rewrite the recursive policies ────────────────────

drop policy if exists "memberships_tenant_admin_read"  on public.tenant_memberships;
drop policy if exists "memberships_tenant_admin_write" on public.tenant_memberships;

create policy "memberships_tenant_admin_read" on public.tenant_memberships
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

create policy "memberships_tenant_admin_write" on public.tenant_memberships
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

-- ── tenants.tenants_owner_update: same structural fix ─────────────────────
-- This policy also embeds a subquery on tenant_memberships. Recursion is
-- only a problem when a SELECT path hits it (UPDATE policies don't fire
-- during reads), but converting to the SECURITY DEFINER helper keeps the
-- pattern consistent and avoids future surprises.

drop policy if exists "tenants_owner_update" on public.tenants;

create or replace function public.current_user_owner_tenant_ids()
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
     and m.role = 'owner'
     and t.disabled_at is null
$$;

create policy "tenants_owner_update" on public.tenants
  for update to authenticated
  using      (id in (select public.current_user_owner_tenant_ids()))
  with check (id in (select public.current_user_owner_tenant_ids()));

notify pgrst, 'reload schema';

commit;
