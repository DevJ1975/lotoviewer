-- Migration 165: Sweep advisor findings on pre-existing modules.
--
-- Catches issues the Supabase database advisor flagged after the
-- Module 1/2/3 application:
--
--   3 ERRORs:
--     incident_people_safe       — view without security_invoker; the
--                                  PII-masking CASE alone isn't enough
--                                  if RLS on incident_people is
--                                  bypassed in the first place.
--     safety_board_trending      — view without security_invoker;
--                                  exposes every tenant's threads to
--                                  any authenticated caller.
--     bbs_number_sequences       — RLS disabled. Internal counter
--                                  written only by the SECURITY
--                                  DEFINER trigger set_bbs_report_number,
--                                  which bypasses RLS, so enabling
--                                  RLS doesn't break the write path.
--                                  Matches the convention for
--                                  incident_number_sequences.
--
--   15 WARNs (function_search_path_mutable): utility + trigger
--   functions missing `SET search_path`. We pin them all to
--   `pg_catalog, public, extensions` — same posture as migration 124's
--   sweep and the Module 1/2/3 functions.
--
-- Idempotent: re-runs are safe.

begin;

-- ────────────────────────────────────────────────────────────────────
-- A. security_invoker on legacy views
-- ────────────────────────────────────────────────────────────────────
alter view public.incident_people_safe   set (security_invoker = true);
alter view public.safety_board_trending  set (security_invoker = true);

-- ────────────────────────────────────────────────────────────────────
-- B. Enable RLS on bbs_number_sequences (internal counter, no policy
--    needed — only the SECURITY DEFINER trigger writes to it)
-- ────────────────────────────────────────────────────────────────────
alter table public.bbs_number_sequences enable row level security;

-- Explicit deny-all policy for the authenticated role so the linter
-- doesn't flag this with the rls_enabled_no_policy INFO downgrade.
-- The set_bbs_report_number trigger runs as the owner (SECURITY
-- DEFINER), which bypasses every policy by design.
drop policy if exists "bbs_number_sequences_deny_app" on public.bbs_number_sequences;
create policy "bbs_number_sequences_deny_app"
  on public.bbs_number_sequences
  for all to authenticated
  using (false)
  with check (false);

comment on table public.bbs_number_sequences is
  'Per-tenant BBS report-number counter. Written only by the SECURITY DEFINER trigger set_bbs_report_number on bbs_observations. RLS is enabled with a deny-all policy for the authenticated role; the trigger bypasses RLS via its owner privileges.';

-- ────────────────────────────────────────────────────────────────────
-- C. Pin search_path on 15 utility / trigger functions
-- ────────────────────────────────────────────────────────────────────
-- All non-SECURITY-DEFINER plpgsql functions. Setting search_path
-- explicitly matches the project's hardened baseline and removes the
-- search_path-injection ambiguity flagged by the advisor.
alter function public.set_updated_at()
  set search_path = pg_catalog, public, extensions;

alter function public.is_safe_webhook_url(text)
  set search_path = pg_catalog, public, extensions;

alter function public.touch_user_digest_prefs_updated_at()
  set search_path = pg_catalog, public, extensions;

alter function public.bbs_score_for(text, text)
  set search_path = pg_catalog, public, extensions;

alter function public.member_normalize_key(text)
  set search_path = pg_catalog, public, extensions;

alter function public.bbs_default_qr_token()
  set search_path = pg_catalog, public, extensions;

alter function public.incident_audit_log_immutable()
  set search_path = pg_catalog, public, extensions;

alter function public.incident_notifications_immutable()
  set search_path = pg_catalog, public, extensions;

alter function public.member_slug(text)
  set search_path = pg_catalog, public, extensions;

alter function public.bbs_observations_before_update()
  set search_path = pg_catalog, public, extensions;

alter function public.bump_safety_thread_activity()
  set search_path = pg_catalog, public, extensions;

alter function public.bump_chat_channel_activity()
  set search_path = pg_catalog, public, extensions;

alter function public.bbs_points_for_kind(text, integer)
  set search_path = pg_catalog, public, extensions;

alter function public.hazardous_waste_areas_touch()
  set search_path = pg_catalog, public, extensions;

alter function public.hazardous_waste_inspection_derive_counts()
  set search_path = pg_catalog, public, extensions;

notify pgrst, 'reload schema';

commit;
