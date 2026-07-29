-- Migration 243: security advisor fix (Phase 0) — enable RLS on a backup table.
-- See docs/audits/scale-audit-6500-users.md.
--
-- _photo_backup_pre_v2 is a one-off backup table with no application read path.
-- Enabling RLS with no policy makes it deny-all to client roles (the service role
-- bypasses RLS), resolving the rls_disabled_in_public advisor ERROR for this table.
--
-- Deferred to the security follow-up issue (need access-path verification first):
--   * em385_project_number_sequences (rls_disabled_in_public) — a sequence table
--     that app code may write to via a non-service path.
--   * loto_placard_publishable_status (security_definer_view) — the SECURITY DEFINER
--     is most likely required for the public/anon QR placard flow; changing it
--     blindly would break that read.
--
-- Idempotent: enabling RLS twice is a no-op.

alter table public._photo_backup_pre_v2 enable row level security;
