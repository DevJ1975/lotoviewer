-- Rollback for migration 304 (Phase 2, the permit vault).
--
-- Lost: every permit, every condition's link to its permit (the conditions
-- themselves stay, as obligations), and the record of notices sent. Export
-- them first if they matter.
--
-- Roll back 306 and 305 first, then revert the code that reads these tables,
-- then run this.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop table if exists public.ms_notification_log;
drop function if exists public.ms_record_obligation_occurrence(uuid, date, text);
drop function if exists public.ms_advance_due_date(date, text, int);

-- A view column cannot be dropped in place, so 298's definition is restored whole.
drop view if exists public.ms_obligation_register;
create view public.ms_obligation_register
with (security_invoker = true) as
select o.id, o.tenant_id, o.facility_id, o.title, o.description, o.regulatory_ref, o.category,
       o.cadence, o.cadence_days, o.next_due_at, o.owner_user_id, o.site_label, o.status,
       o.source, o.system_key, o.discipline, o.source_kind, o.jurisdiction, o.applicability_rationale,
       o.evaluation_cadence_days, o.last_reviewed_at, o.reviewed_by, o.next_review_due,
       o.created_by, o.created_at, o.updated_at,
       last_eval.id               as last_evaluation_id,
       last_eval.completed_at     as last_evaluated_at,
       last_eval.result           as last_result,
       last_eval.nonconformity_id as last_nonconformity_id,
       open_eval.id               as open_evaluation_id,
       open_eval.scheduled_for    as open_evaluation_due,
       open_eval.assigned_to      as open_evaluation_assignee
  from public.compliance_calendar_obligations o
  left join lateral (
    select e.id, e.completed_at, e.result, e.nonconformity_id
      from public.ms_compliance_evaluations e
     where e.tenant_id = o.tenant_id and e.obligation_id = o.id and e.completed_at is not null
     order by e.completed_at desc, e.id desc
     limit 1
  ) last_eval on true
  left join lateral (
    select e.id, e.scheduled_for, e.assigned_to
      from public.ms_compliance_evaluations e
     where e.tenant_id = o.tenant_id and e.obligation_id = o.id and e.completed_at is null
     limit 1   -- uq_ms_compliance_evaluations_open: there is at most one
  ) open_eval on true;

drop index if exists public.idx_compliance_calendar_obligations_permit;
alter table public.compliance_calendar_obligations
  drop constraint if exists compliance_calendar_obligations_permit_source,
  drop constraint if exists compliance_calendar_obligations_permit_fk,
  drop column if exists permit_id;

drop table if exists public.environmental_permits;

notify pgrst, 'reload schema';

commit;
