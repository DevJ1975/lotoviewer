-- Rollback for migration 298 (obligations register and evaluations).
--
-- Drops every compliance evaluation, the register columns, and restores
-- migration 192's calendar policies, including their write access for any
-- member. Roll back 299 first: its evidence trigger sits on the evaluations table.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop table if exists public.ms_compliance_evaluations;
drop function if exists public.ms_compliance_evaluations_sealed();
alter table public.nonconformities drop constraint if exists nonconformities_tenant_id_id_key;

drop policy if exists ccal_obligations_member_read on public.compliance_calendar_obligations;
drop policy if exists ccal_obligations_admin_write on public.compliance_calendar_obligations;
drop policy if exists ccal_events_member_read      on public.compliance_calendar_events;
drop policy if exists ccal_events_admin_write      on public.compliance_calendar_events;

create policy ccal_obligations_tenant_scope on public.compliance_calendar_obligations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy ccal_events_tenant_scope on public.compliance_calendar_events
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists trg_audit_ccal_events        on public.compliance_calendar_events;
drop trigger if exists trg_ccal_obligations_touch   on public.compliance_calendar_obligations;
drop index if exists public.idx_ccal_obligations_register;

alter table public.compliance_calendar_obligations
  drop constraint if exists ccal_obligations_discipline_check,
  drop constraint if exists ccal_obligations_source_kind_check,
  drop constraint if exists ccal_obligations_jurisdiction_check,
  drop constraint if exists ccal_obligations_evaluation_cadence_check,
  drop column if exists next_review_due,
  drop column if exists reviewed_by,
  drop column if exists last_reviewed_at,
  drop column if exists evaluation_cadence_days,
  drop column if exists applicability_rationale,
  drop column if exists jurisdiction,
  drop column if exists source_kind,
  drop column if exists discipline;

notify pgrst, 'reload schema';

commit;
