-- Migration 202: ISO 14001:2015 EMS — phase 2 (objectives & monitoring).
--
-- Two tables that turn the significant aspects from migration 201 into a
-- managed improvement programme:
--
--   1. environmental_objectives — clause 6.2. A measurable (where
--      practicable) environmental objective: an indicator, a baseline, a
--      target, a due date, an improvement direction, an owner, and the
--      method used to evaluate results. Optionally tied to the
--      significant aspect (6.1.2) it addresses.
--
--   2. environmental_objective_readings — clause 9.1.1. The append-only
--      monitoring & measurement trail: a value recorded against an
--      objective at a point in time. The latest reading is the
--      objective's current performance; the series is its trend.
--
-- Deliberately a dedicated model rather than overloading the OH&S
-- ehs_scorecard_targets table (migration 196) — environmental objectives
-- carry an action-plan shape (baseline, direction, evaluation method,
-- aspect linkage) the scorecard's metric rows don't.
--
-- Idempotent.

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1. environmental_objectives — clause 6.2.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.environmental_objectives (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,

  title                text        not null check (length(btrim(title)) > 0),
  description          text,
  -- The significant aspect (migration 201) this objective addresses.
  related_aspect_id    uuid        references public.environmental_aspects(id) on delete set null,

  -- What is measured + its unit. Nullable so a qualitative objective is
  -- still representable, but the register UI nudges toward measurable.
  indicator            text,
  unit                 text,
  baseline_value       numeric,
  baseline_label       text,
  target_value         numeric,
  target_date          date,
  -- Most environmental targets reduce a quantity (emissions, waste); some
  -- increase one (recycling rate). Drives the "achieved?" evaluation.
  improvement_direction text       not null default 'decrease' check (improvement_direction in (
    'decrease','increase')),

  owner_user_id        uuid        references auth.users(id) on delete set null,
  status               text        not null default 'planned' check (status in (
    'planned','in_progress','achieved','missed','cancelled')),
  -- How results are evaluated (clause 6.2.1 requirement).
  evaluation_method    text,
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id) on delete set null,
  updated_by           uuid        references auth.users(id) on delete set null
);

create index if not exists idx_environmental_objectives_tenant
  on public.environmental_objectives(tenant_id, status);
create index if not exists idx_environmental_objectives_aspect
  on public.environmental_objectives(related_aspect_id)
  where related_aspect_id is not null;

comment on table public.environmental_objectives is
  'ISO 14001:2015 clause 6.2 environmental objectives. Measurable targets against significant aspects, evaluated via environmental_objective_readings.';

alter table public.environmental_objectives enable row level security;

drop policy if exists "environmental_objectives_tenant_scope"
  on public.environmental_objectives;
create policy "environmental_objectives_tenant_scope"
  on public.environmental_objectives
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_environmental_objectives_touch
  on public.environmental_objectives;
create trigger trg_environmental_objectives_touch
  before update on public.environmental_objectives
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_environmental_objectives
  on public.environmental_objectives;
create trigger trg_audit_environmental_objectives
  after insert or update or delete on public.environmental_objectives
  for each row execute function public.log_audit('id');

-- ════════════════════════════════════════════════════════════════════════
-- 2. environmental_objective_readings — clause 9.1.1 monitoring trail.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.environmental_objective_readings (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  objective_id  uuid        not null references public.environmental_objectives(id) on delete cascade,
  reading_date  date        not null default current_date,
  value         numeric     not null,
  note          text,
  recorded_by   uuid        references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_environmental_objective_readings_objective
  on public.environmental_objective_readings(tenant_id, objective_id, reading_date desc);

comment on table public.environmental_objective_readings is
  'ISO 14001:2015 clause 9.1.1 monitoring & measurement. Append-only values recorded against an environmental objective; the latest is current performance.';

alter table public.environmental_objective_readings enable row level security;

drop policy if exists "environmental_objective_readings_tenant_scope"
  on public.environmental_objective_readings;
create policy "environmental_objective_readings_tenant_scope"
  on public.environmental_objective_readings
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_environmental_objective_readings
  on public.environmental_objective_readings;
create trigger trg_audit_environmental_objective_readings
  after insert or update or delete on public.environmental_objective_readings
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
