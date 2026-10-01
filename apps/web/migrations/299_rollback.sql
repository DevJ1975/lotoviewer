-- Rollback for migration 299 (evidence store).
--
-- Drops every evidence row. The files stay in the ms-evidence bucket, and
-- the bucket itself stays: removing a bucket that holds objects fails in
-- Supabase, and evidence files are worth keeping until someone decides
-- otherwise. Export ms_evidence first if the rows matter.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop trigger if exists trg_ms_compliance_evaluations_require_evidence on public.ms_compliance_evaluations;
drop function if exists public.ms_compliance_evaluations_require_evidence();
drop table if exists public.ms_evidence;
drop function if exists public.ms_evidence_append_only();

notify pgrst, 'reload schema';

commit;
