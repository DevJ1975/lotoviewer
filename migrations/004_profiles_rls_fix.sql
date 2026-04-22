-- Migration 004: replace recursive profiles read policy
-- The prior policy in migration 003 did a self-referential subquery:
--     exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
-- That subquery hits the same table the policy is protecting, which re-runs
-- RLS on every scanned row and can return empty under some Postgres query
-- plans — masking the user's own row from their SELECT. Symptom: client
-- maybeSingle() returns null even though the row exists and is the user's.
--
-- Fix: split into two non-recursive policies. Own-row read uses the simple
-- auth.uid() = id check. Admin-reads-everyone goes through a SECURITY
-- DEFINER function that bypasses RLS to check the is_admin flag.
--
-- Idempotent — safe to re-run.

-- 1) SECURITY DEFINER helper that reads is_admin without going through RLS.
create or replace function public.current_user_is_admin()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- 2) Drop the recursive policy and replace with two clean ones.
drop policy if exists "profiles_self_or_admin_read" on public.profiles;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all" on public.profiles
  for select using (public.current_user_is_admin());

-- 3) Same pattern for the admin write policy that referenced the table.
drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles
  for all using (public.current_user_is_admin());

-- 4) Ask PostgREST to reload its schema cache so the new function + policies
--    are reflected in the JSON API right away.
notify pgrst, 'reload schema';
