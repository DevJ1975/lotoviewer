-- Migration 191: first-login onboarding completion marker.
--
-- Records when a user finished (or dismissed) the first-login onboarding
-- walkthrough so the popup is shown exactly once. Nullable; existing users
-- get NULL and will see the walkthrough on their next sign-in (harmless —
-- it's a one-time instructional dialog they can dismiss).
--
-- Self-update is already permitted by the profiles_self_update policy from
-- migration 003 (using/with check auth.uid() = id), so the client can stamp
-- this column on its own row.
--
-- Idempotent: add column if not exists.

begin;

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

notify pgrst, 'reload schema';

commit;
