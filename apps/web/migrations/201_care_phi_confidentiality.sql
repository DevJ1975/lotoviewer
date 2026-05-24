-- Migration 201: Care-data confidentiality hardening (Phase 0 of the
-- injured-person case-management plan — see docs/injury-case-management-plan.md).
--
-- Problem this closes: incident_care_cases and incident_care_visits hold
-- medical detail (diagnosis, restrictions, treatment) but their RLS is
-- tenant-WIDE — any tenant member passes. The admin/investigator/
-- case-manager restriction lived only in the API route, so a member
-- hitting PostgREST directly was not blocked at the data layer. ADA
-- 29 CFR 1630.14(c) requires employee medical info be kept confidential
-- with need-to-know access; the HIPAA Security Rule wants the same plus
-- an access trail. This migration moves least-privilege INTO the data
-- layer and adds the audit + consent + segregated-storage scaffolding.
--
-- What it adds:
--   1. can_view_care_phi(incident_id) — security-definer predicate that
--      mirrors can_view_incident_pii() but also admits the designated
--      case manager.
--   2. Tightened RLS on incident_care_cases + incident_care_visits.
--   3. Change-audit triggers on both care tables (reuse log_audit).
--   4. phi_access_log — append-only trail of medical-data views/exports
--      (SELECTs can't be captured by triggers, so the API layer inserts
--      a row on each authorized read; the immutable trigger guarantees
--      the trail can't be edited or deleted after the fact).
--   5. incident_medical_authorizations — the worker's signed release
--      that permits disclosure to a carrier/employer (HIPAA §164.508
--      where applicable; practical necessity always).
--   6. incident_medical_documents — metadata for medical files stored in
--      a RESTRICTED `medical-records` bucket, kept out of the
--      investigator-visible `incident-evidence` bucket. The bucket itself
--      is created via the Supabase dashboard (same convention as
--      migration 061's incident-evidence bucket); paths are
--      `{tenant_id}/{incident_id}/{uuid}.{ext}`.
--
-- Idempotent throughout.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. can_view_care_phi(incident_id)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Returns true when the current user may see medical detail for the
-- given incident:
--   1. superadmin, or
--   2. an owner / admin on the tenant that owns the incident, or
--   3. the assigned_investigator on the incident, or
--   4. the designated case_manager_user_id on the incident's care case.
--
-- Security definer so it can read incidents + memberships + care cases
-- regardless of the caller's own RLS — the function body IS the access
-- rule.

create or replace function public.can_view_care_phi(p_incident_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(public.is_superadmin(), false)
  or exists (
    select 1
      from public.incidents i
      join public.tenant_memberships m
        on m.tenant_id = i.tenant_id
       and m.user_id   = auth.uid()
     where i.id = p_incident_id
       and m.role in ('owner','admin')
  )
  or exists (
    select 1
      from public.incidents i
     where i.id = p_incident_id
       and i.assigned_investigator = auth.uid()
  )
  or exists (
    select 1
      from public.incident_care_cases c
     where c.incident_id = p_incident_id
       and c.case_manager_user_id = auth.uid()
  );
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Tighten care-table RLS to least privilege.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Writes flow through the API on the service-role client (supabaseAdmin),
-- which bypasses RLS, so tightening here does not change the write path.
-- Authenticated reads (the care GET uses the RLS-bound client) still work
-- for authorized roles because they pass can_view_care_phi(); unauthorized
-- members — previously allowed by the tenant-wide policy — are now blocked
-- at the data layer too.

drop policy if exists care_cases_tenant_scope on public.incident_care_cases;
create policy care_cases_phi_scope on public.incident_care_cases
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(incident_id)
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(incident_id)
  );

drop policy if exists care_visits_tenant_scope on public.incident_care_visits;
create policy care_visits_phi_scope on public.incident_care_visits
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(
      (select c.incident_id from public.incident_care_cases c where c.id = care_case_id)
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(
      (select c.incident_id from public.incident_care_cases c where c.id = care_case_id)
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Change-audit triggers on the care tables.
-- ──────────────────────────────────────────────────────────────────────────
--
-- log_audit() writes INSERT/UPDATE/DELETE rows (with old/new jsonb) to
-- public.audit_log, keyed by the PK column passed as tg_argv[0]. Same
-- pattern migration 197 uses for severe-injury reports.

drop trigger if exists trg_audit_incident_care_cases on public.incident_care_cases;
create trigger trg_audit_incident_care_cases
  after insert or update or delete on public.incident_care_cases
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_incident_care_visits on public.incident_care_visits;
create trigger trg_audit_incident_care_visits
  after insert or update or delete on public.incident_care_visits
  for each row execute function public.log_audit('id');

-- ──────────────────────────────────────────────────────────────────────────
-- 4. phi_access_log — append-only view/export trail.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Postgres has no SELECT trigger, so read access to medical data is
-- logged by the API layer (one insert per authorized GET/export). The
-- immutable trigger + REVOKE make the trail append-only: once written,
-- a row cannot be edited or deleted by anyone going through SQL DML.

create table if not exists public.phi_access_log (
  id            bigserial primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  actor_id      uuid,
  actor_email   text,
  resource_type text not null check (resource_type in (
                  'care_case','care_visit','medical_document',
                  'medical_authorization','claim_packet')),
  resource_id   uuid,
  incident_id   uuid,
  action        text not null check (action in ('view','export','print','download')),
  context       text,
  occurred_at   timestamptz not null default now()
);

create index if not exists idx_phi_access_log_tenant_time
  on public.phi_access_log(tenant_id, occurred_at desc);
create index if not exists idx_phi_access_log_incident
  on public.phi_access_log(incident_id, occurred_at desc)
  where incident_id is not null;
create index if not exists idx_phi_access_log_actor
  on public.phi_access_log(actor_id, occurred_at desc)
  where actor_id is not null;

revoke update, delete on public.phi_access_log from public;
revoke update, delete on public.phi_access_log from authenticated;
revoke update, delete on public.phi_access_log from anon;

create or replace function public.phi_access_log_immutable()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'phi_access_log is append-only (tg_op=% on row id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = 'integrity_constraint_violation';
end $$;

drop trigger if exists trg_phi_access_log_immutable on public.phi_access_log;
create trigger trg_phi_access_log_immutable
  before update or delete on public.phi_access_log
  for each row execute function public.phi_access_log_immutable();

alter table public.phi_access_log enable row level security;

-- Reading the access log is itself sensitive — restrict SELECT to
-- owner/admin/superadmin on the tenant. Inserts are open to tenant
-- members (the API attributes the actor); the immutable trigger guards
-- integrity.
drop policy if exists phi_access_log_admin_read on public.phi_access_log;
create policy phi_access_log_admin_read on public.phi_access_log
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or exists (
        select 1 from public.tenant_memberships m
         where m.tenant_id = phi_access_log.tenant_id
           and m.user_id = auth.uid()
           and m.role in ('owner','admin')
      )
    )
  );

drop policy if exists phi_access_log_tenant_insert on public.phi_access_log;
create policy phi_access_log_tenant_insert on public.phi_access_log
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

grant insert, select on public.phi_access_log to authenticated;
grant usage, select on sequence public.phi_access_log_id_seq to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. incident_medical_authorizations — signed consent / release.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_medical_authorizations (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  incident_id         uuid not null references public.incidents(id) on delete cascade,
  -- Soft FK: keep the consent record even if the person row is reassigned.
  person_id           uuid references public.incident_people(id) on delete set null,

  authorization_type  text not null check (authorization_type in (
                        'disclose_to_carrier','disclose_to_employer',
                        'general_medical_release','treatment')),
  -- Who signed and in what capacity (self / guardian / legal representative).
  signatory_name      text,
  signatory_relation  text check (signatory_relation is null or signatory_relation in (
                        'self','guardian','legal_representative')),
  -- What the release covers, e.g. {'work_status','diagnosis','treatment_dates'}.
  scope               text[] not null default array[]::text[],

  signed_at           timestamptz,
  effective_at        timestamptz,
  expires_at          timestamptz,
  revoked_at          timestamptz,

  -- Signed-PDF location in the restricted `medical-records` bucket.
  storage_path        text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_by          uuid references auth.users(id),

  -- expiry can't precede the effective date.
  check (expires_at is null or effective_at is null or expires_at >= effective_at)
);

create index if not exists idx_med_auth_incident
  on public.incident_medical_authorizations(incident_id);
create index if not exists idx_med_auth_tenant
  on public.incident_medical_authorizations(tenant_id);

drop trigger if exists trg_med_auth_touch on public.incident_medical_authorizations;
create trigger trg_med_auth_touch
  before update on public.incident_medical_authorizations
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_med_auth on public.incident_medical_authorizations;
create trigger trg_audit_med_auth
  after insert or update or delete on public.incident_medical_authorizations
  for each row execute function public.log_audit('id');

alter table public.incident_medical_authorizations enable row level security;

drop policy if exists med_auth_phi_scope on public.incident_medical_authorizations;
create policy med_auth_phi_scope on public.incident_medical_authorizations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(incident_id)
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(incident_id)
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 6. incident_medical_documents — segregated medical-file metadata.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_medical_documents (
  id               uuid not null primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  incident_id      uuid not null references public.incidents(id) on delete cascade,
  -- Soft FK so a closed/re-keyed care case doesn't cascade-delete the file row.
  care_case_id     uuid references public.incident_care_cases(id) on delete set null,

  doc_type         text not null check (doc_type in (
                     'work_status_note','clinic_note','fmla','authorization',
                     'rtw_plan','wage_statement','other')),
  -- Path in the RESTRICTED `medical-records` bucket (created via dashboard).
  storage_path     text not null,
  mime_type        text,
  file_size_bytes  int,
  caption          text,

  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id)
);

create index if not exists idx_med_docs_incident
  on public.incident_medical_documents(incident_id);
create index if not exists idx_med_docs_case
  on public.incident_medical_documents(care_case_id)
  where care_case_id is not null;

drop trigger if exists trg_audit_med_docs on public.incident_medical_documents;
create trigger trg_audit_med_docs
  after insert or update or delete on public.incident_medical_documents
  for each row execute function public.log_audit('id');

alter table public.incident_medical_documents enable row level security;

drop policy if exists med_docs_phi_scope on public.incident_medical_documents;
create policy med_docs_phi_scope on public.incident_medical_documents
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(incident_id)
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_care_phi(incident_id)
  );

notify pgrst, 'reload schema';

commit;
