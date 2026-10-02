-- Rollback for migration 295 (context, interested parties, scope, policy).
--
-- Drops the four tables and every row in them. Run only before any tenant
-- has recorded context, scope or policy you need to keep; otherwise export
-- them first.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop table if exists public.ms_policies;
drop table if exists public.ms_scope_statements;
drop table if exists public.ms_interested_parties;
drop table if exists public.ms_context_issues;
alter table public.compliance_calendar_obligations
  drop constraint if exists compliance_calendar_obligations_tenant_id_id_key;

notify pgrst, 'reload schema';

commit;
