-- Rollback for migration 249
--
-- Use this ONLY if the column guard broke a legitimate profile write —
-- i.e. an app path that updates profiles.id, email, is_admin or
-- is_superadmin while holding an end-user JWT rather than the service
-- role. Fix that path to go through supabaseAdmin, then re-apply 249.
--
-- WARNING: while this rollback is in place the self-service privilege
-- escalation is open again — any authenticated user can set
-- is_superadmin on their own row via PostgREST. Treat it as a
-- break-glass step, not a resting state.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop trigger if exists trg_profiles_guard_privileged_columns on public.profiles;
drop function if exists public.profiles_guard_privileged_columns();

-- Restores profiles_visible_write verbatim from 054:82-91. Note this also
-- restores the horizontal hole: the predicate admits any co-tenant, not just
-- admins.
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

notify pgrst, 'reload schema';

commit;
