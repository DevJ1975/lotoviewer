-- Migration 204: ISO 14001:2015 Environmental Management System — phase 1.
--
-- Two tables, mirroring the ISO 45001 pattern (migration 154):
--
--   1. iso14001_clause_evidence — the audit-friendly index pinning a
--      specific evidence row (an environmental incident, a chemical SDS,
--      a hazardous-waste inspection, a compliance obligation, …) to an
--      ISO 14001 clause. The canonical clause-to-module map lives in
--      packages/core/src/iso14001.ts; this table stores user-curated
--      pinning only. Parallel to iso45001_clause_evidence rather than a
--      shared/generalized table — only two standards exist today, so the
--      Rule of Three says don't abstract yet.
--
--   2. environmental_aspects — the defining ISO 14001 artifact with no
--      ISO 45001 analogue (clause 6.1.2). Each row records an activity /
--      product / service, the environmental aspect (how it interacts with
--      the environment), the resulting impact, the life-cycle stage, the
--      operating condition, and a significance rating. Significance uses
--      a documented, deterministic criterion: severity × likelihood on a
--      1-5 scale, "significant" when the score reaches the high band (≥12).
--
-- Idempotent.

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1. iso14001_clause_evidence — curated clause-to-evidence pins.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.iso14001_clause_evidence (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  -- Free text — ISO 14001 clauses range from "4.1" to "10.3"; a check
  -- constraint would lock us out of future revisions. Format validated
  -- at the API boundary (/^\d+(\.\d+)*$/).
  clause_code          text        not null check (length(btrim(clause_code)) > 0),
  source_table         text        not null check (length(btrim(source_table)) > 0),
  -- Text because source rows include both uuids and string IDs.
  source_id            text        not null check (length(btrim(source_id)) > 0),
  captured_at          timestamptz not null default now(),
  captured_by_user_id  uuid        references auth.users(id) on delete set null,
  notes                text,
  created_at           timestamptz not null default now(),
  -- Each (clause, source row) is pinned at most once; re-pin UPSERTs.
  unique (tenant_id, clause_code, source_table, source_id)
);

create index if not exists idx_iso14001_clause_evidence_clause
  on public.iso14001_clause_evidence(tenant_id, clause_code, captured_at desc);

create index if not exists idx_iso14001_clause_evidence_source
  on public.iso14001_clause_evidence(tenant_id, source_table, source_id);

comment on table public.iso14001_clause_evidence is
  'Curated pins from ISO 14001 clauses to specific evidence rows. Complements the static clause-to-module map in @soteria/core/iso14001 with hand-picked artifacts.';

alter table public.iso14001_clause_evidence enable row level security;

drop policy if exists "iso14001_clause_evidence_tenant_scope"
  on public.iso14001_clause_evidence;
create policy "iso14001_clause_evidence_tenant_scope"
  on public.iso14001_clause_evidence
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_iso14001_clause_evidence
  on public.iso14001_clause_evidence;
create trigger trg_audit_iso14001_clause_evidence
  after insert or update or delete on public.iso14001_clause_evidence
  for each row execute function public.log_audit('id');

-- ════════════════════════════════════════════════════════════════════════
-- 2. environmental_aspects — aspects & impacts register (clause 6.1.2).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.environmental_aspects (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,

  -- The activity, product, or service under evaluation.
  activity             text        not null check (length(btrim(activity)) > 0),
  -- How the activity interacts with the environment (the "aspect").
  aspect               text        not null check (length(btrim(aspect)) > 0),
  -- The resulting environmental impact.
  impact               text        not null check (length(btrim(impact)) > 0),

  -- Life-cycle perspective (clause 6.1.2 / 8.1).
  life_cycle_stage     text        not null default 'operation' check (life_cycle_stage in (
    'raw_material','manufacturing','operation','transport','use','end_of_life')),
  -- Condition under which the aspect arises.
  operating_condition  text        not null default 'normal' check (operating_condition in (
    'normal','abnormal','emergency')),
  -- Resource input (energy/water/material) vs. environmental output
  -- (emission/discharge/waste). Optional.
  flow                 text        check (flow is null or flow in ('input','output')),

  -- Significance rating. Documented, deterministic criterion so an
  -- auditor sees a repeatable basis: severity × likelihood on a 1-5
  -- scale (score 1-25); "significant" at the high band (score ≥ 12).
  severity             int         not null default 1 check (severity between 1 and 5),
  likelihood           int         not null default 1 check (likelihood between 1 and 5),
  significance_score   int         generated always as (severity * likelihood) stored,
  is_significant       boolean     generated always as ((severity * likelihood) >= 12) stored,

  -- Existing or planned operational controls (clause 8.1).
  controls             text,
  -- Optional tie-in to the risk register for shared control tracking.
  related_risk_id      uuid        references public.risks(id) on delete set null,
  -- Free-text reference to the originating module row (a chemical, a
  -- waste stream, an incident) without a hard cross-module FK.
  source_reference     text,

  status               text        not null default 'identified' check (status in (
    'identified','controlled','monitored','closed')),
  owner_user_id        uuid        references auth.users(id) on delete set null,
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id) on delete set null,
  updated_by           uuid        references auth.users(id) on delete set null
);

create index if not exists idx_environmental_aspects_tenant
  on public.environmental_aspects(tenant_id, status);
-- Significant aspects drive objectives + operational controls — the
-- register's primary filtered view.
create index if not exists idx_environmental_aspects_significant
  on public.environmental_aspects(tenant_id, significance_score desc)
  where is_significant;
create index if not exists idx_environmental_aspects_risk
  on public.environmental_aspects(related_risk_id)
  where related_risk_id is not null;

comment on table public.environmental_aspects is
  'ISO 14001:2015 clause 6.1.2 environmental aspects & impacts register. Significance = severity × likelihood (1-5 scale); significant at score ≥ 12.';

alter table public.environmental_aspects enable row level security;

drop policy if exists "environmental_aspects_tenant_scope"
  on public.environmental_aspects;
create policy "environmental_aspects_tenant_scope"
  on public.environmental_aspects
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_environmental_aspects_touch
  on public.environmental_aspects;
create trigger trg_environmental_aspects_touch
  before update on public.environmental_aspects
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_environmental_aspects
  on public.environmental_aspects;
create trigger trg_audit_environmental_aspects
  after insert or update or delete on public.environmental_aspects
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
