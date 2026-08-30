-- Migration 249: lock the privileged columns on public.profiles.
--
-- profiles_self_update (migration 003) grants a user UPDATE on their own
-- row, and profiles_visible_write (054) grants it across the caller's
-- visible set. Both were written to carry name/onboarding edits — 003's
-- own comment says "name + must_change_password" — but a Postgres UPDATE
-- policy is row-scoped, not column-scoped, so both also permit writing
-- is_admin and is_superadmin.
--
-- That is a privilege-escalation path, not a theoretical one. The browser
-- talks to PostgREST directly with the public anon key, so RLS is the only
-- gate on that route — requireSuperadmin()'s SUPERADMIN_EMAILS allowlist
-- lives in the Next.js route layer and never runs. Any authenticated user
-- could execute:
--
--   supabase.from('profiles').update({ is_superadmin: true }).eq('id', uid)
--
-- and public.is_superadmin() — which ~536 RLS policies consult — would
-- start returning true for them, granting cross-tenant read and write of
-- every domain table.
--
-- Migration 027 assumed the flag was safe because no UI writes it
-- ("Promotion to superadmin is a manual UPDATE — no UI to flip this flag,
-- by design"). Absence of a UI is not authorization.
--
-- A BEFORE UPDATE trigger is used rather than column-level GRANTs because it
-- is a deny-list: it names the four columns that must never move and leaves
-- everything else alone. A GRANT-based fix is an allow-list, which would have
-- to enumerate every column the browser legitimately writes today
-- (full_name, must_change_password, updated_at, onboarding_completed_at) and
-- would 403 the moment a path anyone missed touches a column outside it. For
-- a security fix shipping ahead of its own code deploy, the failure mode that
-- cannot cause an outage is the right one. The trigger is also independent of
-- which policy admitted the row, and cannot be silently undone by a later
-- `grant all on public.profiles`.
--
-- Self-service columns are deliberately untouched — /welcome,
-- /reset-password and the onboarding dialog write them straight from the
-- browser and must keep working.
--
-- Second, related defect fixed here: profiles_visible_write (054) claims in
-- its own comment to be an admin-only write path, but its predicate is
-- `id in (select current_user_visible_profile_ids())`, and that helper
-- returns *anyone sharing a tenant with the caller* with no role check. So
-- any tenant member could update any co-tenant's profile row. With the
-- trigger in place that is no longer an escalation, but it still lets one
-- user rename another or set their must_change_password, which AuthGate
-- turns into a forced-redirect lockout. Every browser-side profile write in
-- the app is self-scoped (.eq('id', <own uid>)) and every admin-side write
-- goes through supabaseAdmin, so the policy has no legitimate consumer;
-- profiles_self_update (003) already covers the self case.
--
-- Idempotent: create-or-replace + drop-if-exists are safe to re-run.

begin;

create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- service_role (the supabaseAdmin client) and postgres (migrations, seed
  -- scripts, the SQL editor) carry no end-user JWT claim, so admin routes
  -- that legitimately grant or revoke these flags pass straight through.
  -- nullif guards the cast: PostgREST sets the GUC to '' when unauthenticated,
  -- and ''::jsonb raises rather than yielding null.
  if coalesce(
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       ''
     ) not in ('authenticated', 'anon')
  then
    return new;
  end if;

  if new.id            is distinct from old.id
     or new.email         is distinct from old.email
     or new.is_admin      is distinct from old.is_admin
     or new.is_superadmin is distinct from old.is_superadmin
  then
    raise exception
      'profiles.id, email, is_admin and is_superadmin are not self-writable'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_privileged_columns on public.profiles;

create trigger trg_profiles_guard_privileged_columns
  before update on public.profiles
  for each row
  execute function public.profiles_guard_privileged_columns();

drop policy if exists "profiles_visible_write" on public.profiles;

comment on function public.profiles_guard_privileged_columns() is
  'Rejects end-user UPDATEs that change profiles.id, email, is_admin or is_superadmin. RLS UPDATE policies are row-scoped, not column-scoped, so this trigger supplies the column scope. service_role and postgres bypass it.';

notify pgrst, 'reload schema';

commit;
