-- Migration 064: Care management for injured persons.
--
-- A care_case tracks an injured person's medical journey from the
-- initial clinic visit through return-to-work. Each row is keyed on
-- (incident_id, person_id) so multi-victim incidents get one
-- care_case per injured person.
--
-- Days counters drive OSHA 300 columns + the scorecard's DART/LTIR
-- metrics (Phase 4 + 5):
--   days_away_from_work — DART numerator for "days away" cases
--   days_restricted     — DART numerator for "restricted duty" cases
--   days_lost           — LTIR numerator (lost workdays only)
--
-- The values are stored, not computed, because OSHA capping rules
-- (max 180 days per case for the 300 form) need the raw counter to
-- be editable by the case manager.
--
-- next_followup_at drives the daily incident-care-followup cron — a
-- nudge to the case manager to check in with the worker.
--
-- Drug-test fields cover post-incident testing compliance (state-
-- specific testing windows live in app code; this column captures
-- the result and timing).

begin;

create table if not exists public.incident_care_cases (
  id                      uuid not null primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  incident_id             uuid not null references public.incidents(id) on delete cascade,
  -- The injured person on the incident. Soft FK (no constraint) so
  -- the row survives if the person row is reassigned — case
  -- management is sometimes paperwork-only and we don't want a
  -- delete cascade in either direction.
  person_id               uuid references public.incident_people(id) on delete set null,

  case_status             text not null default 'open' check (case_status in (
    'open','modified_duty','full_duty_returned',
    'permanent_restrictions','closed')),

  -- Initial medical visit (first clinic / hospital encounter).
  initial_visit_at        timestamptz,
  treating_physician      text,
  clinic_name             text,
  diagnosis               text,

  -- Counters — see header comment.
  days_away_from_work     int not null default 0 check (days_away_from_work >= 0),
  days_restricted         int not null default 0 check (days_restricted     >= 0),
  days_lost               int not null default 0 check (days_lost           >= 0),

  return_to_work_at       timestamptz,
  modified_duty_start     timestamptz,
  modified_duty_end       timestamptz,
  -- Free-form list of restriction lines ("no lifting > 20 lb",
  -- "no overhead reaching", etc.). Stored as text[] so the OSHA 301
  -- + RTW plan PDFs can render a proper bulleted list.
  restrictions            text[] not null default array[]::text[],

  next_followup_at        timestamptz,

  -- Post-incident drug-test tracking (state-specific compliance).
  drug_test_status        text check (drug_test_status is null or drug_test_status in (
    'not_required','pending','negative','positive','refused')),
  drug_test_at            timestamptz,
  drug_test_notes         text,

  -- Soft pointer to the case manager handling this case (for the
  -- care-followup cron's audience selection). Falls back to tenant
  -- admins if null.
  case_manager_user_id    uuid references auth.users(id),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id),
  updated_by              uuid references auth.users(id),

  -- Phase 1 keeps it 1:1 with (incident, person) — multi-incident
  -- cases (a re-injury counted as new incident) get their own row.
  unique (incident_id, person_id),

  -- modified_duty_end can't be before modified_duty_start.
  check (
    modified_duty_end is null or modified_duty_start is null
    or modified_duty_end >= modified_duty_start
  ),

  -- closed must have an RTW timestamp OR explicit permanent_restrictions
  -- status. Open cases must NOT have an RTW timestamp.
  check (
    (case_status in ('open','modified_duty') and return_to_work_at is null)
    or (case_status in ('full_duty_returned','closed','permanent_restrictions'))
  )
);

create index if not exists idx_care_cases_tenant
  on public.incident_care_cases(tenant_id, case_status);
create index if not exists idx_care_cases_incident
  on public.incident_care_cases(incident_id);
create index if not exists idx_care_cases_followup
  on public.incident_care_cases(next_followup_at)
  where next_followup_at is not null and case_status not in ('closed','full_duty_returned');
create index if not exists idx_care_cases_manager
  on public.incident_care_cases(case_manager_user_id, case_status)
  where case_manager_user_id is not null;

drop trigger if exists trg_care_cases_touch on public.incident_care_cases;
create trigger trg_care_cases_touch
  before update on public.incident_care_cases
  for each row
  execute function public.touch_updated_at();

alter table public.incident_care_cases enable row level security;

drop policy if exists care_cases_tenant_scope on public.incident_care_cases;
create policy care_cases_tenant_scope on public.incident_care_cases
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- incident_care_visits — per-visit log
-- ──────────────────────────────────────────────────────────────────────────
--
-- Lightweight log of each clinic / phone / email touchpoint. Lets
-- the case manager keep a running record without re-using
-- diagnosis/restrictions every time.

create table if not exists public.incident_care_visits (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  care_case_id      uuid not null references public.incident_care_cases(id) on delete cascade,
  visit_at          timestamptz not null default now(),
  visit_type        text not null default 'clinic' check (visit_type in (
    'clinic','phone','email','followup','therapy','other')),
  notes             text,
  attachments_count int not null default 0,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists idx_care_visits_case_when
  on public.incident_care_visits(care_case_id, visit_at desc);

alter table public.incident_care_visits enable row level security;

drop policy if exists care_visits_tenant_scope on public.incident_care_visits;
create policy care_visits_tenant_scope on public.incident_care_visits
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
