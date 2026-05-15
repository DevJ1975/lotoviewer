-- Migration 139: Hazardous Waste — Phase 1
--
-- First real data layer for the hazardous-waste module. Until now the
-- module was just a static catalog in packages/core/src/hazardousWaste.ts
-- and a placeholder hub page. This migration introduces the two tables
-- a CUPA inspection binder actually depends on:
--
--   1. hazardous_waste_areas       — the physical accumulation areas
--                                    (satellite, central, universal,
--                                    used oil, inspection-only) that
--                                    a tenant operates.
--   2. hazardous_waste_inspections — one row per walk-through of an
--                                    area with the per-check verdicts
--                                    captured as a jsonb array.
--
-- Findings are stored inline on the inspection row rather than in a
-- third table because:
--   - they only make sense in the context of a single inspection,
--   - the catalog ids (closed-container, saa-volume-under-limit, …)
--     come from a static list in @soteria/core, so the foreign key
--     surface is application-owned, not relational, and
--   - read patterns are always "show me this inspection's findings",
--     never "find every finding flagged critical across all time"
--     (the binder PDF aggregates by date range, not by check id).
--
-- Audit logging mirrors the established pattern (log_audit trigger);
-- RLS uses the active_tenant_id() / current_user_*_tenant_ids() helpers
-- introduced in migration 131.

begin;

create extension if not exists pgcrypto;

-- ── hazardous_waste_areas ───────────────────────────────────────────────────
--
-- One row per accumulation area at a tenant site. `area_type` mirrors
-- the HazardousWasteAreaType union in @soteria/core/hazardousWaste so
-- the field-check catalog can resolve the correct check list per area.
-- `weekly_cadence_days` is per-area so a tenant can keep central
-- accumulation on the regulatory 7-day cadence while marking a low-
-- traffic universal-waste corner as 30-day.

create table if not exists public.hazardous_waste_areas (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  name                  text not null check (length(btrim(name)) between 1 and 120),
  area_type             text not null check (area_type in (
                            'satellite_accumulation',
                            'central_accumulation',
                            'universal_waste',
                            'used_oil',
                            'inspection_only'
                          )),
  location_notes        text,
  weekly_cadence_days   integer not null default 7 check (weekly_cadence_days between 1 and 90),
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  unique (tenant_id, name)
);

create index if not exists hazardous_waste_areas_tenant_idx
  on public.hazardous_waste_areas (tenant_id, archived_at);

-- ── hazardous_waste_inspections ────────────────────────────────────────────
--
-- One walk-through. The findings jsonb is constrained to the shape
-- emitted by the existing summarizeHazardousWasteDraft() helper:
--   [{ check_id: text, status: 'pass'|'fail'|'na', note: text|null,
--      flagged_critical: bool }]
--
-- A trigger derives counts (total_checks, critical_failures, pass) so
-- list views can render without re-summing the jsonb every time.

create table if not exists public.hazardous_waste_inspections (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  area_id             uuid not null references public.hazardous_waste_areas(id) on delete cascade,
  area_type           text not null check (area_type in (
                          'satellite_accumulation',
                          'central_accumulation',
                          'universal_waste',
                          'used_oil',
                          'inspection_only'
                        )),
  inspected_by        uuid references auth.users(id) on delete set null,
  inspected_at        timestamptz not null default now(),
  container_label     text,
  waste_description   text,
  observations        text,
  findings            jsonb not null default '[]'::jsonb,
  total_checks        integer not null default 0,
  passing_checks      integer not null default 0,
  critical_failures   integer not null default 0,
  status              text not null default 'submitted' check (status in ('draft','submitted')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  check (jsonb_typeof(findings) = 'array')
);

create index if not exists hazardous_waste_inspections_tenant_area_idx
  on public.hazardous_waste_inspections (tenant_id, area_id, inspected_at desc);

create index if not exists hazardous_waste_inspections_tenant_time_idx
  on public.hazardous_waste_inspections (tenant_id, inspected_at desc);

-- ── Derived counts trigger ──────────────────────────────────────────────────
--
-- Keeps total_checks / passing_checks / critical_failures in sync with
-- the findings jsonb. We accept the duplication because list pages
-- otherwise have to either read every row's jsonb or maintain a
-- materialized view. A trigger is cheaper to reason about than a view.

create or replace function public.hazardous_waste_inspection_derive_counts()
returns trigger
language plpgsql
as $$
declare
  v_total       integer := 0;
  v_pass        integer := 0;
  v_critical    integer := 0;
  v_finding     jsonb;
begin
  if new.findings is null then
    new.findings := '[]'::jsonb;
  end if;

  for v_finding in select * from jsonb_array_elements(new.findings) loop
    v_total := v_total + 1;
    if v_finding->>'status' = 'pass' then
      v_pass := v_pass + 1;
    end if;
    if coalesce((v_finding->>'flagged_critical')::boolean, false)
       and v_finding->>'status' = 'fail' then
      v_critical := v_critical + 1;
    end if;
  end loop;

  new.total_checks      := v_total;
  new.passing_checks    := v_pass;
  new.critical_failures := v_critical;
  new.updated_at        := now();
  return new;
end;
$$;

drop trigger if exists trg_hazardous_waste_inspections_counts on public.hazardous_waste_inspections;
create trigger trg_hazardous_waste_inspections_counts
  before insert or update on public.hazardous_waste_inspections
  for each row execute function public.hazardous_waste_inspection_derive_counts();

-- ── updated_at trigger for the areas table ─────────────────────────────────

create or replace function public.hazardous_waste_areas_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_hazardous_waste_areas_touch on public.hazardous_waste_areas;
create trigger trg_hazardous_waste_areas_touch
  before update on public.hazardous_waste_areas
  for each row execute function public.hazardous_waste_areas_touch();

-- ── Audit triggers ─────────────────────────────────────────────────────────

drop trigger if exists trg_audit_hazardous_waste_areas on public.hazardous_waste_areas;
create trigger trg_audit_hazardous_waste_areas
  after insert or update or delete on public.hazardous_waste_areas
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_hazardous_waste_inspections on public.hazardous_waste_inspections;
create trigger trg_audit_hazardous_waste_inspections
  after insert or update or delete on public.hazardous_waste_inspections
  for each row execute function public.log_audit('id');

-- ── RLS ────────────────────────────────────────────────────────────────────
--
-- Read: any tenant member of the row's tenant (or a superadmin).
-- Write (areas): tenant admin/owner.
-- Write (inspections): any tenant member can insert/update their own
--   submissions; only tenant admin/owner can delete. Inspections are
--   tightly bound to who walked the area, so members must be able to
--   record them — gating on admin would force every tech to flag down
--   the EHS manager just to log a Monday walk-through.

alter table public.hazardous_waste_areas       enable row level security;
alter table public.hazardous_waste_inspections enable row level security;

drop policy if exists hazardous_waste_areas_tenant_read on public.hazardous_waste_areas;
create policy hazardous_waste_areas_tenant_read on public.hazardous_waste_areas
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists hazardous_waste_areas_admin_write on public.hazardous_waste_areas;
create policy hazardous_waste_areas_admin_write on public.hazardous_waste_areas
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

drop policy if exists hazardous_waste_inspections_tenant_read on public.hazardous_waste_inspections;
create policy hazardous_waste_inspections_tenant_read on public.hazardous_waste_inspections
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists hazardous_waste_inspections_member_write on public.hazardous_waste_inspections;
create policy hazardous_waste_inspections_member_write on public.hazardous_waste_inspections
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists hazardous_waste_inspections_self_update on public.hazardous_waste_inspections;
create policy hazardous_waste_inspections_self_update on public.hazardous_waste_inspections
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or created_by = auth.uid()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or created_by = auth.uid()
    )
  );

drop policy if exists hazardous_waste_inspections_admin_delete on public.hazardous_waste_inspections;
create policy hazardous_waste_inspections_admin_delete on public.hazardous_waste_inspections
  for delete to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

commit;
