-- Migration 139 rollback — companion to
-- 139_compliance_calendar_and_legal_registry.sql.
--
-- Applied: 2026-05-13 on Soteria Main DB (zwtnpyjifbdytlektxlc) via the
-- Supabase MCP. Use this script only if the forward migration must be
-- undone (e.g. emergency rollback before any production data has
-- accumulated on the new tables). Cascading deletes drop the policies
-- and indexes automatically.
--
-- NOT idempotent in the sense of "safe to run on a fully populated
-- database" — this DROPs the audit log along with the tables. Verify
-- the new tables are empty (or that their data is disposable) before
-- running.
--
-- The set_updated_at() helper is *not* dropped here. Migration 139's
-- forward script created it only if it didn't already exist; other
-- objects may now depend on it, so a blind drop would cascade past
-- the compliance feature.

begin;

-- Triggers go with their tables, but drop them explicitly so the
-- script doesn't depend on cascade ordering.
drop trigger if exists trg_compliance_obligations_updated_at on public.compliance_obligations;
drop trigger if exists trg_legal_register_updated_at         on public.legal_register;

-- Drop the completion log first — it references compliance_obligations.
drop table if exists public.compliance_obligation_completions cascade;
drop table if exists public.compliance_obligations            cascade;
drop table if exists public.legal_register                    cascade;

notify pgrst, 'reload schema';

commit;
