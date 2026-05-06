-- Migration 049: Break tenant_memberships RLS recursion.
--
-- Two policies in migration 029 introduced infinite recursion:
--
--   memberships_tenant_admin_read  / memberships_tenant_admin_write
--
-- Both ran an inline subquery against `public.tenant_memberships`
-- INSIDE a policy on `public.tenant_memberships` — Postgres re-applies
-- the same policies to that subquery, which re-applies them to its
-- subquery, …, hitting the recursion limit and returning:
--
--   ERROR: 42P01: infinite recursion detected in policy for relation "tenant_memberships"
--
-- Symptom in the app: /superadmin/tenants and the tenant-switcher
-- dropdown fail to load with the recursion error.
--
-- Fix: introduce a SECURITY DEFINER helper that returns the caller's
-- admin/owner tenant_ids without re-entering the policy stack, and
-- rewrite the two policies to use it. Same posture as the existing
-- `public.current_user_tenant_ids()` helper.

begin;

-- 1. SECURITY DEFINER helper — returns tenant_ids where the current user
--    is owner or admin. SECURITY DEFINER bypasses RLS on the read of
--    tenant_memberships, so the recursive call doesn't happen.
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

revoke all on function public.current_user_admin_tenant_ids() from public;
grant execute on function public.current_user_admin_tenant_ids() to authenticated;

-- 2. Rewrite the two recursive policies. Drop-and-create so the new
--    bodies are unambiguous (CREATE OR REPLACE doesn't apply to policies).
drop policy if exists "memberships_tenant_admin_read"  on public.tenant_memberships;
drop policy if exists "memberships_tenant_admin_write" on public.tenant_memberships;

create policy "memberships_tenant_admin_read" on public.tenant_memberships
  for select to authenticated
  using (
    tenant_id in (select public.current_user_admin_tenant_ids())
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

-- 3. Refresh PostgREST so the new function is visible to the API.
notify pgrst, 'reload schema';

commit;
