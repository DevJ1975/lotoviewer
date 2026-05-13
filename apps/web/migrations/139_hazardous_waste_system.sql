-- Migration 139: Hazardous Waste durable operating records.
--
-- Turns the initial hazardous-waste hub/manual into a tenant-scoped
-- system of record for the first usable workflow:
--   - facility generator profile
--   - waste streams and determinations
--   - accumulation areas
--   - containers
--   - submitted field inspections
--   - corrective actions
--   - shipment/manifest tracking foundation

begin;

create table if not exists public.hazardous_waste_facility_profiles (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  facility_name            text not null check (length(trim(facility_name)) between 1 and 200),
  epa_id                   text,
  state_generator_id       text,
  generator_category       text not null default 'unknown'
                             check (generator_category in ('unknown', 'vsqg', 'sqg', 'lqg')),
  emergency_phone          text,
  emergency_coordinator    text,
  cupa_agency              text,
  notes                    text,
  created_by               uuid references auth.users(id),
  updated_by               uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (tenant_id)
);

create table if not exists public.hazardous_waste_streams (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  name                  text not null check (length(trim(name)) between 1 and 200),
  generating_process    text,
  physical_state        text not null default 'unknown'
                          check (physical_state in ('unknown', 'solid', 'liquid', 'sludge', 'gas', 'mixed')),
  hazards               text[] not null default '{}'::text[],
  waste_codes           text[] not null default '{}'::text[],
  determination_basis   text,
  determination_status  text not null default 'draft'
                          check (determination_status in ('draft', 'pending_review', 'approved', 'archived')),
  reviewed_by_name      text,
  reviewed_at           date,
  next_review_date      date,
  created_by            uuid references auth.users(id),
  updated_by            uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_hw_streams_tenant_status
  on public.hazardous_waste_streams(tenant_id, determination_status, updated_at desc);
create index if not exists idx_hw_streams_review_due
  on public.hazardous_waste_streams(tenant_id, next_review_date)
  where next_review_date is not null and determination_status <> 'archived';
create unique index if not exists ux_hw_streams_tenant_id
  on public.hazardous_waste_streams(tenant_id, id);

create table if not exists public.hazardous_waste_accumulation_areas (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  name                     text not null check (length(trim(name)) between 1 and 200),
  area_type                text not null check (area_type in (
                             'satellite_accumulation',
                             'central_accumulation',
                             'universal_waste',
                             'used_oil',
                             'inspection_only'
                           )),
  location_details         text,
  owner_name               text,
  backup_owner_name        text,
  inspection_cadence_days  int not null default 7 check (inspection_cadence_days between 1 and 366),
  site_notes               text,
  active                   boolean not null default true,
  last_inspected_at        timestamptz,
  created_by               uuid references auth.users(id),
  updated_by               uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_hw_areas_tenant_active
  on public.hazardous_waste_accumulation_areas(tenant_id, active, area_type, name);
create index if not exists idx_hw_areas_due
  on public.hazardous_waste_accumulation_areas(tenant_id, active, last_inspected_at);
create unique index if not exists ux_hw_areas_tenant_id
  on public.hazardous_waste_accumulation_areas(tenant_id, id);

create table if not exists public.hazardous_waste_containers (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  area_id                   uuid not null references public.hazardous_waste_accumulation_areas(id) on delete restrict,
  waste_stream_id           uuid references public.hazardous_waste_streams(id) on delete set null,
  label_id                  text not null check (length(trim(label_id)) between 1 and 120),
  waste_description         text,
  container_type            text,
  capacity                  numeric check (capacity is null or capacity >= 0),
  capacity_unit             text check (capacity_unit is null or capacity_unit in ('gal', 'L', 'mL', 'kg', 'g', 'lb', 'oz', 'yd3', 'ea', 'other')),
  accumulation_start_date   date,
  status                    text not null default 'accumulating'
                            check (status in ('accumulating', 'ready_for_pickup', 'shipped', 'closed', 'archived')),
  hazard_flags              text[] not null default '{}'::text[],
  last_inspected_at         timestamptz,
  notes                     text,
  created_by                uuid references auth.users(id),
  updated_by                uuid references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (tenant_id, label_id)
);

create index if not exists idx_hw_containers_tenant_status
  on public.hazardous_waste_containers(tenant_id, status, updated_at desc);
create index if not exists idx_hw_containers_area
  on public.hazardous_waste_containers(tenant_id, area_id, status);
create index if not exists idx_hw_containers_accumulation_age
  on public.hazardous_waste_containers(tenant_id, accumulation_start_date)
  where accumulation_start_date is not null and status in ('accumulating', 'ready_for_pickup');
create unique index if not exists ux_hw_containers_tenant_id
  on public.hazardous_waste_containers(tenant_id, id);

create table if not exists public.hazardous_waste_inspections (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  area_id         uuid not null references public.hazardous_waste_accumulation_areas(id) on delete restrict,
  container_id    uuid references public.hazardous_waste_containers(id) on delete set null,
  inspector_id    uuid references auth.users(id),
  inspected_at    timestamptz not null default now(),
  result          text not null default 'pass' check (result in ('pass', 'issues_found', 'blocked')),
  checked_ids     text[] not null default '{}'::text[],
  flagged_ids     text[] not null default '{}'::text[],
  observations    text,
  follow_up_notes text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_hw_inspections_tenant_recent
  on public.hazardous_waste_inspections(tenant_id, inspected_at desc);
create index if not exists idx_hw_inspections_area_recent
  on public.hazardous_waste_inspections(tenant_id, area_id, inspected_at desc);
create unique index if not exists ux_hw_inspections_tenant_id
  on public.hazardous_waste_inspections(tenant_id, id);

create table if not exists public.hazardous_waste_corrective_actions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  inspection_id   uuid references public.hazardous_waste_inspections(id) on delete set null,
  area_id         uuid references public.hazardous_waste_accumulation_areas(id) on delete set null,
  container_id    uuid references public.hazardous_waste_containers(id) on delete set null,
  title           text not null check (length(trim(title)) between 1 and 240),
  description     text,
  priority        text not null default 'normal' check (priority in ('normal', 'high', 'critical')),
  status          text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  due_at          date,
  assigned_to_name text,
  resolved_at     timestamptz,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_hw_actions_open
  on public.hazardous_waste_corrective_actions(tenant_id, status, priority, due_at)
  where status in ('open', 'in_progress');

create table if not exists public.hazardous_waste_shipments (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants(id) on delete cascade,
  shipment_number            text not null check (length(trim(shipment_number)) between 1 and 120),
  manifest_tracking_number   text,
  transporter_name           text,
  tsdf_name                  text,
  shipped_at                 date,
  expected_return_copy_due_at date,
  returned_copy_received_at  date,
  status                     text not null default 'planned'
                             check (status in ('planned', 'shipped', 'return_copy_due', 'closed', 'cancelled')),
  notes                      text,
  created_by                 uuid references auth.users(id),
  updated_by                 uuid references auth.users(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (tenant_id, shipment_number)
);

create index if not exists idx_hw_shipments_tenant_status
  on public.hazardous_waste_shipments(tenant_id, status, shipped_at desc nulls last);
create index if not exists idx_hw_shipments_return_due
  on public.hazardous_waste_shipments(tenant_id, expected_return_copy_due_at)
  where status in ('shipped', 'return_copy_due') and expected_return_copy_due_at is not null;

do $$
begin
  alter table public.hazardous_waste_containers
    add constraint hw_containers_area_same_tenant_fk
    foreign key (tenant_id, area_id)
    references public.hazardous_waste_accumulation_areas(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.hazardous_waste_containers
    add constraint hw_containers_stream_same_tenant_fk
    foreign key (tenant_id, waste_stream_id)
    references public.hazardous_waste_streams(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.hazardous_waste_inspections
    add constraint hw_inspections_area_same_tenant_fk
    foreign key (tenant_id, area_id)
    references public.hazardous_waste_accumulation_areas(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.hazardous_waste_inspections
    add constraint hw_inspections_container_same_tenant_fk
    foreign key (tenant_id, container_id)
    references public.hazardous_waste_containers(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.hazardous_waste_corrective_actions
    add constraint hw_actions_inspection_same_tenant_fk
    foreign key (tenant_id, inspection_id)
    references public.hazardous_waste_inspections(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.hazardous_waste_corrective_actions
    add constraint hw_actions_area_same_tenant_fk
    foreign key (tenant_id, area_id)
    references public.hazardous_waste_accumulation_areas(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.hazardous_waste_corrective_actions
    add constraint hw_actions_container_same_tenant_fk
    foreign key (tenant_id, container_id)
    references public.hazardous_waste_containers(tenant_id, id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

create or replace function public.hw_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_hw_facility_touch on public.hazardous_waste_facility_profiles;
create trigger trg_hw_facility_touch
  before update on public.hazardous_waste_facility_profiles
  for each row execute function public.hw_touch_updated_at();

drop trigger if exists trg_hw_streams_touch on public.hazardous_waste_streams;
create trigger trg_hw_streams_touch
  before update on public.hazardous_waste_streams
  for each row execute function public.hw_touch_updated_at();

drop trigger if exists trg_hw_areas_touch on public.hazardous_waste_accumulation_areas;
create trigger trg_hw_areas_touch
  before update on public.hazardous_waste_accumulation_areas
  for each row execute function public.hw_touch_updated_at();

drop trigger if exists trg_hw_containers_touch on public.hazardous_waste_containers;
create trigger trg_hw_containers_touch
  before update on public.hazardous_waste_containers
  for each row execute function public.hw_touch_updated_at();

drop trigger if exists trg_hw_actions_touch on public.hazardous_waste_corrective_actions;
create trigger trg_hw_actions_touch
  before update on public.hazardous_waste_corrective_actions
  for each row execute function public.hw_touch_updated_at();

drop trigger if exists trg_hw_shipments_touch on public.hazardous_waste_shipments;
create trigger trg_hw_shipments_touch
  before update on public.hazardous_waste_shipments
  for each row execute function public.hw_touch_updated_at();

alter table public.hazardous_waste_facility_profiles  enable row level security;
alter table public.hazardous_waste_streams            enable row level security;
alter table public.hazardous_waste_accumulation_areas enable row level security;
alter table public.hazardous_waste_containers         enable row level security;
alter table public.hazardous_waste_inspections        enable row level security;
alter table public.hazardous_waste_corrective_actions enable row level security;
alter table public.hazardous_waste_shipments          enable row level security;

drop policy if exists hw_facility_tenant_scope on public.hazardous_waste_facility_profiles;
create policy hw_facility_tenant_scope on public.hazardous_waste_facility_profiles
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_streams_tenant_scope on public.hazardous_waste_streams;
create policy hw_streams_tenant_scope on public.hazardous_waste_streams
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_areas_tenant_scope on public.hazardous_waste_accumulation_areas;
create policy hw_areas_tenant_scope on public.hazardous_waste_accumulation_areas
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_containers_tenant_scope on public.hazardous_waste_containers;
create policy hw_containers_tenant_scope on public.hazardous_waste_containers
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_inspections_tenant_scope on public.hazardous_waste_inspections;
create policy hw_inspections_tenant_scope on public.hazardous_waste_inspections
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_actions_tenant_scope on public.hazardous_waste_corrective_actions;
create policy hw_actions_tenant_scope on public.hazardous_waste_corrective_actions
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists hw_shipments_tenant_scope on public.hazardous_waste_shipments;
create policy hw_shipments_tenant_scope on public.hazardous_waste_shipments
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
