-- Migration 055: function hardening — search_path + EXECUTE grants.
--
-- Closes the WARN-level Supabase advisor lints surfaced after migration
-- 054 / data_hygiene_snak_king_2026_05_06:
--
--   * function_search_path_mutable        (23 functions)
--   * anon_security_definer_function_executable        (17 functions)
--   * authenticated_security_definer_function_executable (same 17)
--
-- This migration does NOT touch function bodies. It pins each flagged
-- function's search_path via ALTER FUNCTION ... SET (which Postgres
-- attaches as a per-function GUC) and revokes EXECUTE on the
-- SECURITY DEFINER triggers / service-only helpers that were left
-- callable by anon/authenticated by default.
--
-- The legitimate client-callable SECURITY DEFINER helpers
-- (current_user_*, is_superadmin, active_tenant_id) keep their grants —
-- the lint flags them only because they are SECURITY DEFINER, not
-- because they are misconfigured.

begin;

-- ─── 1. Pin search_path on the 23 flagged functions ─────────────────────
-- Value chosen: `pg_catalog, public, extensions`.
--   - pg_catalog: built-ins (now, to_char, format, coalesce, lpad, …)
--   - public:    every function references public.<table> already, but
--                future maintainers might add unqualified refs; cheap insurance.
--   - extensions: pgcrypto's gen_random_bytes (used by next_signon_token).

alter function public._hygiene_now_iso()                  set search_path = pg_catalog, public, extensions;
alter function public.enforce_ppe_alone_rule()            set search_path = pg_catalog, public, extensions;
alter function public.hot_work_emit_push()                set search_path = pg_catalog, public, extensions;
alter function public.hot_work_emit_webhooks()            set search_path = pg_catalog, public, extensions;
alter function public.jha_audit_log_immutable()           set search_path = pg_catalog, public, extensions;
alter function public.near_miss_audit_log_immutable()     set search_path = pg_catalog, public, extensions;
alter function public.next_hot_work_serial(timestamptz)   set search_path = pg_catalog, public, extensions;
alter function public.next_permit_serial(timestamptz)     set search_path = pg_catalog, public, extensions;
alter function public.next_signon_token()                 set search_path = pg_catalog, public, extensions;
alter function public.next_tenant_number()                set search_path = pg_catalog, public, extensions;
alter function public.permits_emit_push()                 set search_path = pg_catalog, public, extensions;
alter function public.permits_emit_webhooks()             set search_path = pg_catalog, public, extensions;
alter function public.risk_audit_log_immutable()          set search_path = pg_catalog, public, extensions;
alter function public.set_hot_work_serial()               set search_path = pg_catalog, public, extensions;
alter function public.set_permit_serial()                 set search_path = pg_catalog, public, extensions;
alter function public.set_permit_signon_token()           set search_path = pg_catalog, public, extensions;
alter function public.set_review_link_token()             set search_path = pg_catalog, public, extensions;
alter function public.storage_path_tenant(text)           set search_path = pg_catalog, public, extensions;
alter function public.tests_emit_push()                   set search_path = pg_catalog, public, extensions;
alter function public.tests_emit_webhooks()               set search_path = pg_catalog, public, extensions;
alter function public.touch_loto_device_updated_at()      set search_path = pg_catalog, public, extensions;
alter function public.touch_updated_at()                  set search_path = pg_catalog, public, extensions;
alter function public.update_updated_at()                 set search_path = pg_catalog, public, extensions;

-- ─── 2. Revoke EXECUTE on SECURITY DEFINER trigger / service helpers ────
-- These are invoked by triggers (running as table owner) or by
-- service-role server code — never directly from a user session. They
-- inherited the default EXECUTE TO PUBLIC at create time, which the
-- advisor correctly flags because anon/authenticated could have called
-- arbitrary push notifications (emit_push), webhook events
-- (fire_webhooks), etc. with the elevated owner privileges.

revoke execute on function public.emit_push(jsonb)             from anon, authenticated, public;
revoke execute on function public.fire_webhooks(text, jsonb)   from anon, authenticated, public;
revoke execute on function public.handle_new_user()            from anon, authenticated, public;
revoke execute on function public.hot_work_emit_push()         from anon, authenticated, public;
revoke execute on function public.hot_work_emit_webhooks()     from anon, authenticated, public;
revoke execute on function public.jhas_audit_capture()         from anon, authenticated, public;
revoke execute on function public.log_audit()                  from anon, authenticated, public;
revoke execute on function public.near_misses_audit_capture()  from anon, authenticated, public;
revoke execute on function public.permits_emit_push()          from anon, authenticated, public;
revoke execute on function public.permits_emit_webhooks()      from anon, authenticated, public;
revoke execute on function public.risks_audit_capture()        from anon, authenticated, public;
revoke execute on function public.seed_wls_demo()              from anon, authenticated, public;
revoke execute on function public.set_jha_number()             from anon, authenticated, public;
revoke execute on function public.set_near_miss_number()       from anon, authenticated, public;
revoke execute on function public.set_risk_number()            from anon, authenticated, public;
revoke execute on function public.tests_emit_push()            from anon, authenticated, public;
revoke execute on function public.tests_emit_webhooks()        from anon, authenticated, public;

-- The following SECURITY DEFINER helpers KEEP their grants — they are
-- legitimately called from RLS policies and client code:
--   active_tenant_id, current_user_admin_tenant_ids, current_user_is_admin,
--   current_user_owner_tenant_ids, current_user_tenant_ids, is_superadmin
-- The advisor still warns on them because they are SECURITY DEFINER;
-- that's expected — they need definer rights to read auth.users /
-- tenant_memberships across the RLS boundary.

commit;
