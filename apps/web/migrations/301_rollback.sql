-- Rollback for migration 301: environmental checklists.
--
-- DESTRUCTIVE, in three ways:
--   * Environmental inspections are DELETED (with their responses, by cascade)
--     before inspections.domain is dropped. Dropping the column alone would leave
--     them indistinguishable from safety inspections, and they would start feeding
--     the injury-risk model and leading signals again.
--   * environmental_checklist_templates / _runs are dropped: the record of which
--     runs satisfied which deadlines, and the signatures, are lost.
--   * nonconformities.facility_id and compliance_calendar_events.inspection_id are
--     dropped; findings and events stay, without their site and checklist links.
-- The environmental-evidence bucket is NOT removed (Supabase refuses to drop a
-- non-empty bucket from SQL and the files are the only copy); its policies are.
--
-- Idempotent.

begin;

drop policy if exists "env_evidence_tenant_select" on storage.objects;
drop policy if exists "env_evidence_tenant_insert" on storage.objects;
drop policy if exists "env_evidence_admin_update" on storage.objects;
drop policy if exists "env_evidence_admin_delete" on storage.objects;

drop table if exists public.environmental_checklist_runs;
drop table if exists public.environmental_checklist_templates;

drop index if exists public.uq_nonconformities_env_source;
drop index if exists public.idx_nonconformities_facility;
alter table public.nonconformities drop column if exists facility_id;

drop index if exists public.uq_ccal_events_inspection;
alter table public.compliance_calendar_events drop column if exists inspection_id;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'inspections' and column_name = 'domain') then
    delete from public.inspections where domain = 'environmental';
    drop index if exists public.idx_inspections_tenant_domain;
    alter table public.inspections drop column domain;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
