-- Migration 302: compliance calendar v2 - facility scope, library metadata,
-- reminders, and an owner-aware program view.
--
-- 1. Facility scoping. The obligations table got a facility_id in migration 210
--    (bucket B: null = shared by every facility) but its policy is hand-written
--    (ccal_obligations_tenant_scope, 192), so migration 211 skipped it and every
--    facility's deadlines showed in every facility's view. The policy is rewritten
--    with the 211 facility clause; shared rows (facility_id null, including the
--    system obligations) still show in both modes.
-- 2. Library metadata: which environmental program, which legal register entry and
--    checklist template an obligation comes from, which library item and
--    jurisdiction, and whether it is anchored to a period end (so completing it
--    keeps it on period ends rather than drifting).
-- 3. lead_days (reminder window) and last_reminded_on (the weekly throttle).
-- 4. source widened to 'library' and 'ai' next to 'system' and 'tenant'.
--
-- Library obligations use system_key 'env:<library key>:<facility id>', so the
-- existing unique (tenant_id, system_key) index makes seeding idempotent.
--
-- Depends on 298 (legal_register), 193 (inspection_templates), 210/211.
-- Idempotent. Rollback: 302_rollback.sql (destructive: see its header).

begin;

alter table public.compliance_calendar_obligations
  add column if not exists program text
    check (program is null or program in ('stormwater','outfall','air','wastewater','hazardous_waste','manifest','spcc','epcra')),
  add column if not exists legal_register_id uuid references public.legal_register(id) on delete set null,
  add column if not exists checklist_template_id uuid references public.inspection_templates(id) on delete set null,
  add column if not exists library_key text check (library_key is null or length(library_key) <= 120),
  add column if not exists jurisdiction text check (jurisdiction is null or jurisdiction ~ '^(federal|[A-Z]{2})$'),
  add column if not exists due_anchor text not null default 'fixed' check (due_anchor in ('fixed', 'period_end')),
  add column if not exists lead_days int not null default 30 check (lead_days between 0 and 365),
  add column if not exists last_reminded_on date;

-- Widen the source check without guessing its generated name.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.compliance_calendar_obligations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
       and pg_get_constraintdef(oid) ilike '%system%'
  loop
    execute format('alter table public.compliance_calendar_obligations drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.compliance_calendar_obligations'::regclass
       and conname = 'compliance_calendar_obligations_source_check'
  ) then
    alter table public.compliance_calendar_obligations
      add constraint compliance_calendar_obligations_source_check
      check (source in ('system', 'tenant', 'library', 'ai'));
  end if;
end $$;

create index if not exists idx_ccal_obligation_facility_due
  on public.compliance_calendar_obligations (tenant_id, facility_id, next_due_at) where status = 'open';

drop policy if exists ccal_obligations_tenant_scope on public.compliance_calendar_obligations;
create policy ccal_obligations_tenant_scope on public.compliance_calendar_obligations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
