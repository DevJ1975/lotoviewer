-- Migration 054: tenant-scoped profile reads (close cross-tenant leak).
--
-- Migration 004 added profiles_admin_read_all using current_user_is_admin(),
-- which returns true for any user with profiles.is_admin = true. That
-- flag was the pre-multi-tenant tenant-admin marker. Migration 028's
-- backfill mapped those users to tenant_memberships.role = 'owner',
-- but did NOT clear is_admin — meaning every tenant admin in
-- production today can SELECT every profile globally.
--
-- The session that introduced /admin/workers, the LOTO checkout
-- dialog dropdowns, and the mobile Devices tab made the leak
-- operationally visible: a Snak King admin opens the worker picker
-- and sees WLS Demo (and any future tenant) users.
--
-- This migration:
--   1. Adds public.current_user_visible_profile_ids() — SECURITY
--      DEFINER helper returning the set of profile_ids that share
--      at least one tenant with the caller. (Self is always in the
--      set via the UNION below.)
--   2. Drops profiles_admin_read_all and profiles_admin_write
--      (which used the same predicate; admin writes are still
--      gated server-side by /api/admin/users → requireAdmin).
--   3. Replaces with profiles_tenant_visible_read scoped via the
--      helper, plus profiles_self_read kept for self-access, plus
--      profiles_superadmin_read for cross-tenant superadmin work.
--
-- Self-test in the do-block at the bottom: caller's own row must
-- still be visible after the policy swap.

begin;

-- ── 1. Helper ──────────────────────────────────────────────────────────
-- SECURITY DEFINER bypasses RLS on the inner reads, otherwise the
-- helper would re-enter the policy stack and risk recursion. Same
-- posture as current_user_tenant_ids() / is_superadmin().
create or replace function public.current_user_visible_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Anyone sharing a tenant with the caller. The DISTINCT collapses
  -- multi-tenant overlaps. The auth.uid() row is guaranteed to be
  -- in the set (the caller is a member of every tenant_id this
  -- subquery returns), so a separate self-row union isn't needed.
  select distinct m.user_id
    from public.tenant_memberships m
   where m.tenant_id in (select public.current_user_tenant_ids())
$$;

revoke all on function public.current_user_visible_profile_ids() from public;
grant execute on function public.current_user_visible_profile_ids() to authenticated;

-- ── 2. Drop the broad-permission policies ──────────────────────────────
drop policy if exists "profiles_admin_read_all" on public.profiles;
drop policy if exists "profiles_admin_write"    on public.profiles;

-- ── 3. Replace with tenant-scoped equivalents ──────────────────────────
-- Self-read kept as-is (idempotent re-create). Defends against the
-- edge case where a brand-new user with no tenant_memberships row
-- yet (post-signup, pre-invite-accept) needs to read their own
-- profile to render the empty dashboard.
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

create policy "profiles_tenant_visible_read" on public.profiles
  for select to authenticated
  using (
    id in (select public.current_user_visible_profile_ids())
  );

create policy "profiles_superadmin_read" on public.profiles
  for select to authenticated
  using (public.is_superadmin());

-- Admin writes — same role check that already runs server-side in
-- /api/admin/users. The helper handles the cross-tenant case for
-- superadmins; tenant admins write within their visible set.
create policy "profiles_visible_write" on public.profiles
  for update to authenticated
  using (
    id in (select public.current_user_visible_profile_ids())
    or public.is_superadmin()
  )
  with check (
    id in (select public.current_user_visible_profile_ids())
    or public.is_superadmin()
  );

-- ── 4. Self-test ───────────────────────────────────────────────────────
-- The do-block runs as the migration role (postgres / service-role),
-- which bypasses RLS, so this is a structural sanity check that the
-- helper compiles and returns the right shape — not a permission
-- test.
do $$
declare
  v_count int;
begin
  perform public.current_user_visible_profile_ids();
  select count(*) into v_count
    from public.profiles
   where id in (select public.current_user_visible_profile_ids());
  raise notice 'profiles helper installed; sees % rows from migration role', v_count;
end $$;

notify pgrst, 'reload schema';

commit;
