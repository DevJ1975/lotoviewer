-- Migration 201: Fleet Safety — pre-trip vehicle inspections (Phase 2).
--
-- A driver runs a checklist against a vehicle before a trip (and optionally
-- post-trip / periodic). Mirrors the equipment-readiness pre-use pattern:
-- the checklist results live in a jsonb `items` array so the item set can
-- evolve without a schema change, with `passed` denormalized for fast
-- filtering. A failed inspection takes the vehicle out of service (the API
-- flips fleet_vehicles.status — kept explicit rather than a trigger so the
-- side effect is visible at the call site).
--
-- Standard tenant_id + RLS + audit/touch triggers, same as migration 200.

begin;

create table if not exists public.fleet_vehicle_inspections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  vehicle_id      uuid not null references public.fleet_vehicles(id) on delete cascade,
  -- Who performed it (a fleet driver). Nullable: an admin can log one too.
  driver_id       uuid references public.fleet_driver_profiles(id) on delete set null,
  inspection_type text not null default 'pre_trip' check (inspection_type in (
                    'pre_trip','post_trip','periodic')),
  performed_at    timestamptz not null default now(),
  odometer_miles  numeric check (odometer_miles is null or odometer_miles >= 0),
  -- [{ key, label, status: 'pass'|'fail'|'na', note? }]
  items           jsonb not null default '[]'::jsonb,
  -- Denormalized roll-up: false when any item failed.
  passed          boolean not null default true,
  defects_noted   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null
);

create index if not exists idx_fleet_inspections_vehicle
  on public.fleet_vehicle_inspections(vehicle_id, performed_at desc);
create index if not exists idx_fleet_inspections_failed
  on public.fleet_vehicle_inspections(tenant_id, performed_at desc)
  where passed = false;

drop trigger if exists trg_fleet_vehicle_inspections_touch_updated_at on public.fleet_vehicle_inspections;
create trigger trg_fleet_vehicle_inspections_touch_updated_at
  before update on public.fleet_vehicle_inspections
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_fleet_vehicle_inspections on public.fleet_vehicle_inspections;
create trigger trg_audit_fleet_vehicle_inspections
  after insert or update or delete on public.fleet_vehicle_inspections
  for each row execute function public.log_audit();

alter table public.fleet_vehicle_inspections enable row level security;

drop policy if exists fleet_vehicle_inspections_tenant_scope on public.fleet_vehicle_inspections;
create policy fleet_vehicle_inspections_tenant_scope on public.fleet_vehicle_inspections
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
