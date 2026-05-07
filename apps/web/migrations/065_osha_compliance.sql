-- Migration 065: OSHA 1904 recordkeeping — establishments, 300 log
-- entries, 300A annual summaries, and per-incident classification
-- snapshots.
--
-- The 300 log is computed from incidents + classifications + care
-- cases — but we cache it in osha_300_log_entries because:
--   1. The log is the regulatory record. Storing the cached row at
--      classification time pins the values that went on the form,
--      so a later edit to (say) days_away_from_work doesn't
--      retroactively rewrite the audit trail.
--   2. Year-end posting (Feb 1 – Apr 30) requires a stable snapshot
--      of "what was on the log on certification day".
--   3. The 300A annual summary aggregates classifications by year +
--      establishment; a materialised cache gives that a clean source.
--
-- All cached rows refresh on each classify POST + on care_case PATCH
-- of any column that drives a 300 column (handled in the API layer,
-- not via DB triggers — the refresh logic is non-trivial and easier
-- to test in app code).

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. osha_establishments — physical locations / business units that
--    each get their own 300 log + 300A.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Per OSHA 1904, an "establishment" is a single physical location.
-- Multi-location tenants get one row per site. The certifying
-- executive's name + title go on the 300A signature block.

create table if not exists public.osha_establishments (
  id                            uuid not null primary key default gen_random_uuid(),
  tenant_id                     uuid not null references public.tenants(id) on delete cascade,
  establishment_name            text not null,
  street                        text,
  city                          text,
  state                         text,                       -- 2-char US state
  zip                           text,
  naics_code                    text,                       -- 6-digit NAICS

  -- Per-year inputs that drive 300A rates: average annual employees +
  -- total hours worked. Stored as jsonb keyed by year (string) so a
  -- multi-year history lives in one row:
  --   { "2025": { "employees": 47, "hours": 96720 },
  --     "2026": { "employees": 49, "hours": 104260 } }
  hours_employees_by_year       jsonb not null default '{}'::jsonb,

  -- Certifying executive (for the 300A signature block).
  certifying_executive_name     text,
  certifying_executive_title    text,

  is_partial_year               boolean not null default false,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  created_by                    uuid references auth.users(id),
  updated_by                    uuid references auth.users(id)
);

create index if not exists idx_osha_establishments_tenant
  on public.osha_establishments(tenant_id);

drop trigger if exists trg_osha_establishments_touch on public.osha_establishments;
create trigger trg_osha_establishments_touch
  before update on public.osha_establishments
  for each row
  execute function public.touch_updated_at();

alter table public.osha_establishments enable row level security;

drop policy if exists osha_establishments_tenant_scope on public.osha_establishments;
create policy osha_establishments_tenant_scope on public.osha_establishments
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
-- 2. incident_classifications — per-incident snapshot of the
--    recordability decision tree.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Single row per incident (unique constraint). Captures the raw
-- answers the classifier walked through, the resulting classification,
-- and (Phase 4+) any AI suggestion that was considered. The
-- decision_path jsonb preserves the ordered Q&A for audit — if a
-- regulator questions a "not recordable" call years later, the
-- classifier's reasoning is still on file.

create table if not exists public.incident_classifications (
  id                          uuid not null primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  incident_id                 uuid not null unique references public.incidents(id) on delete cascade,

  is_work_related             boolean not null,
  is_new_case                 boolean not null,
  meets_recording_criteria    boolean not null,

  -- Final classification per OSHA 1904.7. NULL when not recordable.
  classification              text check (classification is null or classification in (
    'death','days_away','restricted','other_recordable')),

  -- Privacy concern case per 1904.29(b)(7-9): name suppressed on the
  -- 300 log, replaced with "Privacy Case". Includes intimate-body-part
  -- injuries, sexual assault, mental illness, HIV/AIDS/hepatitis/TB,
  -- and any case the worker requests in writing.
  is_privacy_case             boolean not null default false,

  -- Ordered Q&A trail the classifier walked through.
  decision_path               jsonb not null default '[]'::jsonb,

  -- AI assist (Phase 6+) — never auto-overrides the human answer.
  ai_suggested_classification text check (ai_suggested_classification is null
    or ai_suggested_classification in ('death','days_away','restricted','other_recordable')),
  ai_confidence               numeric(3, 2) check (ai_confidence is null
    or (ai_confidence >= 0 and ai_confidence <= 1)),

  -- Audit.
  classified_by               uuid references auth.users(id),
  classified_at               timestamptz not null default now(),
  override_reason             text,
  -- When the human disagreed with the AI suggestion, capture the
  -- delta so the AI assist can be tuned over time.
  human_overrode_ai           boolean not null default false,

  updated_at                  timestamptz not null default now()
);

create index if not exists idx_classifications_tenant
  on public.incident_classifications(tenant_id);
create index if not exists idx_classifications_recordable
  on public.incident_classifications(tenant_id, classification)
  where meets_recording_criteria = true;

drop trigger if exists trg_classifications_touch on public.incident_classifications;
create trigger trg_classifications_touch
  before update on public.incident_classifications
  for each row
  execute function public.touch_updated_at();

alter table public.incident_classifications enable row level security;

drop policy if exists classifications_tenant_scope on public.incident_classifications;
create policy classifications_tenant_scope on public.incident_classifications
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
-- 3. osha_300_log_entries — cached row per (incident, year).
-- ──────────────────────────────────────────────────────────────────────────
--
-- Mirrors the columns of the OSHA 300 form. Refreshed by the
-- /api/incidents/[id]/classify POST and the care_case PATCH paths.
-- Year is derived from incidents.occurred_at — incidents that span
-- year boundaries (rare; e.g. injury Dec 30, lost-time runs into
-- January) are recorded against the year of the original event.

create table if not exists public.osha_300_log_entries (
  id                          uuid not null primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  establishment_id            uuid references public.osha_establishments(id) on delete set null,
  incident_id                 uuid not null references public.incidents(id) on delete cascade,
  year                        int  not null,

  -- 300 columns A–N + injury_type. Names mirror the form's column
  -- labels for clarity at the rendering layer.
  case_number                 text not null,                -- A — uses incidents.report_number
  employee_name               text,                          -- B — "Privacy Case" when is_privacy_case
  job_title                   text,                          -- C
  date_of_injury              date not null,                 -- D
  location_text               text,                          -- E
  injury_description          text,                          -- F — short description for the form

  -- G–J: classification radio buttons (exactly one true)
  classification              text not null check (classification in (
    'death','days_away','restricted','other_recordable')),

  -- K–L: counters (set when classification is days_away or restricted)
  days_away                   int not null default 0,
  days_restricted             int not null default 0,

  -- M: injury vs illness (six categories on the form)
  injury_type                 text not null default 'injury' check (injury_type in (
    'injury','skin_disorder','respiratory','poisoning','hearing_loss','other_illness')),

  is_privacy_case             boolean not null default false,

  refreshed_at                timestamptz not null default now(),
  unique (incident_id, year)
);

create index if not exists idx_300_log_tenant_year
  on public.osha_300_log_entries(tenant_id, year, establishment_id);
create index if not exists idx_300_log_establishment
  on public.osha_300_log_entries(establishment_id, year)
  where establishment_id is not null;

alter table public.osha_300_log_entries enable row level security;

drop policy if exists osha_300_log_tenant_scope on public.osha_300_log_entries;
create policy osha_300_log_tenant_scope on public.osha_300_log_entries
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
-- 4. osha_annual_summaries — 300A per (establishment, year).
-- ──────────────────────────────────────────────────────────────────────────
--
-- Generated on demand by the /api/osha/300a route from
-- osha_300_log_entries + the establishment's hours_employees_by_year
-- jsonb. Once certified (certified_at + certified_by), the row is
-- locked — the 300A is the document that gets posted publicly Feb 1
-- through Apr 30, so editing it after certification would invalidate
-- the post.

create table if not exists public.osha_annual_summaries (
  id                          uuid not null primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  establishment_id            uuid not null references public.osha_establishments(id) on delete cascade,
  year                        int  not null,

  -- Aggregated counts pulled from osha_300_log_entries:
  --   { "deaths": int, "days_away": int, "restricted": int,
  --     "other_recordable": int,
  --     "total_days_away": int, "total_days_restricted": int,
  --     "by_injury_type": { "injury": int, "skin_disorder": int, ... } }
  totals_json                 jsonb not null,
  total_hours_worked          int not null,
  annual_avg_employees        int not null,

  -- Certification — both fields together = locked.
  certified_by                uuid references auth.users(id),
  certified_at                timestamptz,
  certified_typed_name        text,

  -- Posting tracking — the 300A must be posted publicly Feb 1 - Apr 30.
  posted_at                   timestamptz,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique (tenant_id, establishment_id, year),

  check ((certified_at is null) = (certified_by is null))
);

create index if not exists idx_300a_tenant_year
  on public.osha_annual_summaries(tenant_id, year);

drop trigger if exists trg_300a_touch on public.osha_annual_summaries;
create trigger trg_300a_touch
  before update on public.osha_annual_summaries
  for each row
  execute function public.touch_updated_at();

alter table public.osha_annual_summaries enable row level security;

drop policy if exists osha_300a_tenant_scope on public.osha_annual_summaries;
create policy osha_300a_tenant_scope on public.osha_annual_summaries
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
