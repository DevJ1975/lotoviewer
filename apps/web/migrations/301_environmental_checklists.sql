-- Migration 301: environmental checklists on the generic inspection engine.
--
-- Environmental checklists reuse inspection_templates / inspection_template_items
-- / inspections / inspection_responses (scoring, response storage, audit trail),
-- so nothing is rebuilt. What is environmental is recorded beside them:
--
--   inspections.domain                  'safety' | 'environmental'. Safety analytics
--                                       (the injury-risk model's inspection fail
--                                       rate, the leading signals) read EVERY
--                                       inspection, so without this marker an oil
--                                       sheen at an outfall would raise the injury
--                                       risk score. Existing rows stay 'safety'.
--   environmental_checklist_templates   a template's library origin: which library
--                                       item, built for which jurisdictions, which
--                                       version.
--   environmental_checklist_runs        a run's environmental facts: facility, the
--                                       calendar obligation it satisfies, the
--                                       subject (an outfall), the signature and
--                                       attestation.
--   compliance_calendar_events.inspection_id  links a completion to its checklist;
--                                       unique, so submitting twice cannot complete
--                                       the same occurrence twice.
--   nonconformities.facility_id         which site a finding belongs to, plus a
--                                       unique index so a retried submit cannot
--                                       raise the same finding twice. RLS on
--                                       nonconformities is unchanged.
--   environmental-evidence bucket       private; members upload, only tenant admins
--                                       replace or delete, so evidence photos are
--                                       not editable by whoever took them.
--
-- Idempotent. Rollback: 301_rollback.sql (destructive: see its header).

begin;

alter table public.inspections
  add column if not exists domain text not null default 'safety'
    check (domain in ('safety', 'environmental'));

create index if not exists idx_inspections_tenant_domain on public.inspections (tenant_id, domain, status);

create table if not exists public.environmental_checklist_templates (
  template_id      uuid primary key references public.inspection_templates(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  library_key      text not null check (length(library_key) between 1 and 100),
  -- The layers it was built from, e.g. 'federal+CA'.
  jurisdiction_key text not null check (length(jurisdiction_key) between 1 and 40),
  program          text not null check (program in ('stormwater','outfall','air','wastewater','hazardous_waste','manifest','spcc','epcra')),
  subject_type     text not null check (subject_type in ('facility','outfall','permit','hw_area')),
  cadence          text not null
                     check (cadence in ('once','monthly','quarterly','semiannual','annual','biennial','triennial','quinquennial','custom_days')),
  cadence_days     int check (cadence_days is null or cadence_days > 0),
  library_version  text not null check (length(library_version) <= 40),
  last_verified    date,
  created_at       timestamptz not null default now(),
  unique (tenant_id, library_key, jurisdiction_key),
  check (cadence <> 'custom_days' or cadence_days is not null)
);

create table if not exists public.environmental_checklist_runs (
  inspection_id    uuid primary key references public.inspections(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  facility_id      uuid not null,
  -- The calendar obligation this run satisfies, if it was started from one.
  obligation_id    uuid references public.compliance_calendar_obligations(id) on delete set null,
  occurrence_at    date,
  subject_type     text check (subject_type is null or subject_type in ('facility','outfall','permit','hw_area')),
  subject_id       text check (subject_id is null or length(subject_id) <= 100),
  jurisdiction_key text check (jurisdiction_key is null or length(jurisdiction_key) <= 40),
  library_version  text check (library_version is null or length(library_version) <= 40),
  -- { name, signed_at, image_path }
  signature        jsonb check (signature is null or jsonb_typeof(signature) = 'object'),
  attested         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade
);

create index if not exists idx_env_checklist_runs_facility on public.environmental_checklist_runs (tenant_id, facility_id);
create index if not exists idx_env_checklist_runs_obligation on public.environmental_checklist_runs (obligation_id) where obligation_id is not null;

alter table public.compliance_calendar_events
  add column if not exists inspection_id uuid references public.inspections(id) on delete set null;
create unique index if not exists uq_ccal_events_inspection
  on public.compliance_calendar_events (inspection_id) where inspection_id is not null;

alter table public.nonconformities
  add column if not exists facility_id uuid references public.facilities(id) on delete set null;
create index if not exists idx_nonconformities_facility on public.nonconformities (tenant_id, facility_id) where facility_id is not null;
create unique index if not exists uq_nonconformities_env_source
  on public.nonconformities (tenant_id, source_reference) where source_reference like 'env-%';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.environmental_checklist_templates enable row level security;

drop policy if exists env_checklist_templates_read on public.environmental_checklist_templates;
create policy env_checklist_templates_read on public.environmental_checklist_templates
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists env_checklist_templates_admin_write on public.environmental_checklist_templates;
create policy env_checklist_templates_admin_write on public.environmental_checklist_templates
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

alter table public.environmental_checklist_runs enable row level security;

-- Anyone on the team can run a checklist and read a facility's runs.
drop policy if exists env_checklist_runs_member on public.environmental_checklist_runs;
create policy env_checklist_runs_member on public.environmental_checklist_runs
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists trg_env_checklist_runs_touch on public.environmental_checklist_runs;
create trigger trg_env_checklist_runs_touch
  before update on public.environmental_checklist_runs
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_env_checklist_runs on public.environmental_checklist_runs;
create trigger trg_audit_env_checklist_runs
  after insert or update or delete on public.environmental_checklist_runs
  for each row execute function public.log_audit('inspection_id');

-- ── Evidence bucket ─────────────────────────────────────────────────────────
-- First path segment = tenant id (storage_path_tenant, migration 033).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'environmental-evidence', 'environmental-evidence', false,
  26214400,  -- 25 MB
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public             = excluded.public;

drop policy if exists "env_evidence_tenant_select" on storage.objects;
drop policy if exists "env_evidence_tenant_insert" on storage.objects;
drop policy if exists "env_evidence_admin_update" on storage.objects;
drop policy if exists "env_evidence_admin_delete" on storage.objects;

create policy "env_evidence_tenant_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'environmental-evidence'
    and (public.is_superadmin() or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  );

create policy "env_evidence_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'environmental-evidence'
    and (public.is_superadmin() or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  );

-- Evidence is a record: whoever took the photo cannot replace or delete it.
create policy "env_evidence_admin_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'environmental-evidence'
    and (public.is_superadmin() or public.storage_path_tenant(name) in (select public.current_user_admin_tenant_ids()))
  )
  with check (
    bucket_id = 'environmental-evidence'
    and (public.is_superadmin() or public.storage_path_tenant(name) in (select public.current_user_admin_tenant_ids()))
  );

create policy "env_evidence_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'environmental-evidence'
    and (public.is_superadmin() or public.storage_path_tenant(name) in (select public.current_user_admin_tenant_ids()))
  );

notify pgrst, 'reload schema';

commit;
