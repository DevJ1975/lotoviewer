-- Rollback for migration 305 (Phase 2, management of change).
--
-- Lost: every change record and its impacts, resolutions and history in
-- these tables. Their evidence files stay in ms_evidence. Export them first
-- if they matter.
--
-- Roll back 306 first, then revert the code that reads these tables, then
-- run this.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop function if exists public.ms_open_change(jsonb, jsonb);
drop table if exists public.ms_change_impacts;
drop table if exists public.ms_changes;
drop function if exists public.ms_change_impacts_guard();
drop function if exists public.ms_changes_guard();
drop function if exists public.ms_normalize_legal_entity(text);

notify pgrst, 'reload schema';

commit;
