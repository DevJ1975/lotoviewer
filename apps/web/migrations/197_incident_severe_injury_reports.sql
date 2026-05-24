-- Migration 197: OSHA 1904.39 severe-injury reporting tracker.
--
-- 1904.39 requires phoning/filing with OSHA within 8 hours of a
-- work-related fatality, or 24 hours of an in-patient hospitalization,
-- amputation, or loss of an eye. This is distinct from 1904.7
-- recordability — we already capture that in incident_classifications —
-- and missing the window is a citable violation, so an incident can
-- carry one row per reportable trigger with a live deadline + the proof
-- of filing (OSHA case number, method, who/when).
--
-- The deadline itself is derived in app code (oshaSevereInjuryReport.ts)
-- from trigger_type + basis_at; we store the inputs + the filing, not
-- the computed clock.
--
-- Tenant-scoped (investigators + EHS manage reporting, not only admins),
-- mirroring the incident module. Idempotent throughout.

begin;

create table if not exists public.incident_severe_injury_reports (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  incident_id      uuid not null references public.incidents(id) on delete cascade,
  trigger_type     text not null check (trigger_type in (
                     'fatality', 'in_patient_hospitalization', 'amputation', 'loss_of_eye'
                   )),
  -- When the employer learned the event occurred — the 8h/24h clock start.
  basis_at         timestamptz not null,
  -- Filing proof. reported_at null = not yet reported.
  reported_at      timestamptz,
  report_method    text check (report_method is null or report_method in (
                     'osha_phone', 'osha_online', 'area_office'
                   )),
  osha_case_number text,
  notes            text,
  reported_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null,
  updated_by       uuid references public.profiles(id) on delete set null,
  -- One row per (incident, trigger) so the upsert key is stable.
  constraint uq_incident_severe_injury_report unique (incident_id, trigger_type)
);

create index if not exists idx_incident_severe_injury_reports_tenant
  on public.incident_severe_injury_reports(tenant_id);
create index if not exists idx_incident_severe_injury_reports_incident
  on public.incident_severe_injury_reports(incident_id);

drop trigger if exists trg_incident_severe_injury_reports_touch on public.incident_severe_injury_reports;
create trigger trg_incident_severe_injury_reports_touch
  before update on public.incident_severe_injury_reports
  for each row
  execute function public.touch_updated_at();

drop trigger if exists trg_audit_incident_severe_injury_reports on public.incident_severe_injury_reports;
create trigger trg_audit_incident_severe_injury_reports
  after insert or update or delete on public.incident_severe_injury_reports
  for each row execute function public.log_audit('id');

alter table public.incident_severe_injury_reports enable row level security;

drop policy if exists incident_severe_injury_reports_tenant_scope on public.incident_severe_injury_reports;
create policy incident_severe_injury_reports_tenant_scope on public.incident_severe_injury_reports
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
