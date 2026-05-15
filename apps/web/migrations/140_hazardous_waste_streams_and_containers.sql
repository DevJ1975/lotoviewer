-- Migration 140: Hazardous Waste foundation — streams + containers.
--
-- First record-keeping slice for the hazardous-waste module. Before
-- this migration the module shipped only static catalog metadata
-- (HAZARDOUS_WASTE_FIELD_CHECKS, _CALENDAR, _DOCUMENT_PACKETS) plus
-- the offline mobile field draft. Now the tenant can persist:
--
--   hazardous_waste_streams      reusable waste-stream master records
--                                (process, hazards, codes, determination,
--                                 generator category)
--
--   hazardous_waste_containers   physical container instances bound to
--                                a stream + accumulation area, with
--                                start-date so the containerAgeStatus
--                                helper can render OK / approaching /
--                                over-limit per RCRA 262.16/17.
--
-- Mirrors the project convention used by 089_chemicals_module.sql:
--   • tenant_id NOT NULL with cascade on tenants.id
--   • RLS via active_tenant_id() + current_user_tenant_ids()
--   • touch_updated_at trigger on every table
--   • additive, idempotent (`if not exists`, `drop policy if exists`)
--
-- Out of scope (subsequent slices):
--   • accumulation_areas + accumulation_inspections (audit slice)
--   • waste_shipments + waste_manifests (manifest slice)
--   • biennial_report + cupa_binder export jobs (records slice)

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. hazardous_waste_streams
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.hazardous_waste_streams (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,

  name                text not null check (length(trim(name)) between 1 and 200),
  generating_process  text check (generating_process is null or length(generating_process) <= 500),
  description         text check (description is null or length(description) <= 4000),

  -- Physical state seen at the point of generation. Distinct from container
  -- volume_unit so a "sludge" stream can ship in pounds or kilograms.
  physical_state      text check (physical_state is null or physical_state in (
    'solid','liquid','gas','sludge','mixed'
  )),

  -- Free-text arrays — keys validated at the API layer, not in DB, so a
  -- new RCRA code doesn't require a migration.
  hazards             text[] not null default '{}'::text[],
  waste_codes         text[] not null default '{}'::text[],

  -- Generator category drives the federal accumulation-time limit used
  -- by containerAgeStatus(). Stream-level (not container-level) because
  -- the regulatory determination follows the waste, not the drum.
  generator_category  text not null default 'lqg'
    check (generator_category in ('lqg','sqg','vsqg')),

  -- SQG only: TSDF > 200 mi extends the accumulation limit to 270 days
  -- per 40 CFR 262.16(f). LQG and VSQG ignore this flag.
  long_haul           boolean not null default false,

  determination_basis text check (determination_basis is null or length(determination_basis) <= 2000),

  status              text not null default 'draft'
    check (status in ('draft','active','archived')),
  owner_user_id       uuid references auth.users(id),
  review_due_date     date,
  notes               text check (notes is null or length(notes) <= 4000),

  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  archived_at         timestamptz
);

create index if not exists idx_hw_streams_tenant_status
  on public.hazardous_waste_streams(tenant_id, status);
create index if not exists idx_hw_streams_tenant_name
  on public.hazardous_waste_streams(tenant_id, lower(name));
create index if not exists idx_hw_streams_owner
  on public.hazardous_waste_streams(owner_user_id)
  where owner_user_id is not null;

drop trigger if exists trg_hw_streams_touch on public.hazardous_waste_streams;
create trigger trg_hw_streams_touch
  before update on public.hazardous_waste_streams
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. hazardous_waste_containers
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.hazardous_waste_containers (
  id                       uuid not null primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,

  -- restrict (not cascade): you should never silently delete a stream
  -- that has containers attached. Archive the stream instead.
  stream_id                uuid not null references public.hazardous_waste_streams(id) on delete restrict,

  label                    text not null check (length(trim(label)) between 1 and 120),
  area_type                text not null check (area_type in (
    'satellite_accumulation','central_accumulation',
    'universal_waste','used_oil','inspection_only'
  )),
  area_location            text check (area_location is null or length(area_location) <= 200),

  -- Null when not yet placed in central accumulation. Required to compute
  -- aging via containerAgeStatus(); the helper returns 'unknown' when null.
  accumulation_started_at  timestamptz,

  volume_quantity          numeric(12,3) check (volume_quantity is null or volume_quantity >= 0),
  volume_unit              text check (volume_unit is null or volume_unit in (
    'gallons','liters','quarts','pounds','kilograms','grams'
  )),

  status                   text not null default 'open'
    check (status in ('open','closed','in_shipment','disposed')),
  notes                    text check (notes is null or length(notes) <= 2000),

  created_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id),
  archived_at              timestamptz
);

create index if not exists idx_hw_containers_tenant_status
  on public.hazardous_waste_containers(tenant_id, status);
create index if not exists idx_hw_containers_stream
  on public.hazardous_waste_containers(stream_id);
-- Aging hotspot: only active containers care about age.
create index if not exists idx_hw_containers_open_started
  on public.hazardous_waste_containers(tenant_id, accumulation_started_at)
  where status = 'open' and accumulation_started_at is not null;

drop trigger if exists trg_hw_containers_touch on public.hazardous_waste_containers;
create trigger trg_hw_containers_touch
  before update on public.hazardous_waste_containers
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Cross-tenant guard
--
-- A container's stream must belong to the SAME tenant. RLS already makes
-- it impossible to read or write across tenants, but defense-in-depth at
-- the schema level lets us drop the RLS on this table later without
-- introducing a data-integrity hole.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.hazardous_waste_container_guard()
  returns trigger
  language plpgsql
as $$
declare
  v_stream_tenant uuid;
begin
  select tenant_id into v_stream_tenant
    from public.hazardous_waste_streams
   where id = new.stream_id;

  if v_stream_tenant is null then
    raise exception 'hazardous_waste_container_guard: stream % not found', new.stream_id;
  end if;
  if v_stream_tenant <> new.tenant_id then
    raise exception 'hazardous_waste_container_guard: stream tenant does not match container tenant';
  end if;
  return new;
end $$;

alter function public.hazardous_waste_container_guard()
  set search_path = pg_catalog, public;

drop trigger if exists trg_hw_containers_guard on public.hazardous_waste_containers;
create trigger trg_hw_containers_guard
  before insert or update of stream_id, tenant_id
  on public.hazardous_waste_containers
  for each row
  execute function public.hazardous_waste_container_guard();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS — standard project pattern (089_chemicals_module.sql)
-- ──────────────────────────────────────────────────────────────────────────
alter table public.hazardous_waste_streams    enable row level security;
alter table public.hazardous_waste_containers enable row level security;

drop policy if exists hw_streams_tenant on public.hazardous_waste_streams;
create policy hw_streams_tenant on public.hazardous_waste_streams
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

drop policy if exists hw_containers_tenant on public.hazardous_waste_containers;
create policy hw_containers_tenant on public.hazardous_waste_containers
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

grant select, insert, update, delete on public.hazardous_waste_streams    to authenticated;
grant select, insert, update, delete on public.hazardous_waste_containers to authenticated;

notify pgrst, 'reload schema';

commit;
