-- Rollback for migration 302: compliance calendar v2.
--
-- DESTRUCTIVE: obligations created from the library or by AI (source 'library' or
-- 'ai') are DELETED, because the restored source check only allows 'system' and
-- 'tenant'. The added columns (program, library and checklist links, lead_days,
-- last_reminded_on) are dropped, losing reminder state. The original tenant-only
-- policy is restored, so every facility's deadlines show in every facility's view
-- again.
--
-- Idempotent.

begin;

delete from public.compliance_calendar_obligations where source in ('library', 'ai');

alter table public.compliance_calendar_obligations drop constraint if exists compliance_calendar_obligations_source_check;
alter table public.compliance_calendar_obligations
  add constraint compliance_calendar_obligations_source_check check (source in ('system', 'tenant'));

drop index if exists public.idx_ccal_obligation_facility_due;

alter table public.compliance_calendar_obligations
  drop column if exists program,
  drop column if exists legal_register_id,
  drop column if exists checklist_template_id,
  drop column if exists library_key,
  drop column if exists jurisdiction,
  drop column if exists due_anchor,
  drop column if exists lead_days,
  drop column if exists last_reminded_on;

drop policy if exists ccal_obligations_tenant_scope on public.compliance_calendar_obligations;
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

notify pgrst, 'reload schema';

commit;
