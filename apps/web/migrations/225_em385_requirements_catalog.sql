-- Migration 225: EM-385 Compliance — requirements catalog (global reference).
--
-- EM 385-1-1 is the USACE Safety and Occupational Health Requirements Manual.
-- This table is the authoritative list of the documents and records a contract
-- must keep, tagged by manual edition (2024 / 2014) and by record family. It is
-- NOT tenant-scoped: it is a shared code list, seeded by migration 226 and read
-- by every tenant. A project's register (migration 228) is instantiated from
-- these rows.
--
-- RLS posture (the one place this module breaks the tenant-scope mold): the
-- table has no tenant_id, so the standard active_tenant_id() predicate would
-- match zero rows. Instead: SELECT is granted to all authenticated users;
-- there is deliberately NO authenticated write policy — writes happen only via
-- migration / service role.
--
-- Idempotent.

begin;

create table if not exists public.em385_requirements (
  id                       uuid not null primary key default gen_random_uuid(),
  -- Which manual edition this requirement belongs to.
  edition                  text not null check (edition in ('2024','2014')),
  -- Record family — see EM385_CATEGORIES in packages/core/src/em385.ts.
  category                 text not null check (category in (
    'app_plan','site_specific_plan','form_record','training_cert',
    'competent_person','inspection','permit','exposure_medical')),
  -- Stable identifier, unique within an edition (e.g. 'PLAN-LOTO'). Lets the
  -- seed be idempotent and lets future edits target a row without guessing.
  code                     text not null,
  title                    text not null,
  description              text,
  -- Manual reference. Topical/edition-aware (e.g. 'EM 385-1-1 (2024) App A
  -- Part 11'); exact chapter/section numbers should be reconciled against the
  -- official manual when this catalog is curated further.
  citation                 text,
  -- Free-form grouping hint for the UI ('document','designation','recurring',…).
  record_type              text,
  -- Seeded into a new project's register by default? false = optional /
  -- as-applicable item a user opts into.
  default_required         boolean not null default true,
  -- Human retention rule, e.g. '29 CFR 1910.1020' (30-yr exposure/medical).
  retention_rule           text,
  -- Statutory retention window in years; drives the computed retain-until date.
  retention_years          int,
  -- Renewal cadence for certs/inspections that expire.
  renewal_interval_months  int,
  -- A FEATURES id (packages/core/src/features.ts) for deep-linking to the
  -- module that is the system-of-record for this evidence.
  links_module             text,
  sort_order               int  not null default 0,
  created_at               timestamptz not null default now(),

  unique (edition, code)
);

create index if not exists idx_em385_requirements_edition_cat
  on public.em385_requirements(edition, category, sort_order);
create index if not exists idx_em385_requirements_default
  on public.em385_requirements(edition) where default_required;

alter table public.em385_requirements enable row level security;

-- Global reference table: any authenticated user may read it; nobody writes it
-- through PostgREST (migration 226 / service role only).
drop policy if exists em385_requirements_read on public.em385_requirements;
create policy em385_requirements_read on public.em385_requirements
  for select to authenticated
  using (true);

notify pgrst, 'reload schema';

commit;
