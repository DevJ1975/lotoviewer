-- Migration 202: Fleet Safety & Journey Management — registers + cross-module links (Phase 1).
--
-- First slice of the fleet-safety module. Establishes the vehicle and
-- driver registers that every later slice (pre-trip inspections, journey
-- management plans, monitoring) builds on, plus the cross-module linkage
-- the rest of the platform needs:
--
--   * fleet_driver_profiles — extends the existing loto_workers roster
--     (no duplicate people) with licensing / DOT-medical / hazmat-
--     endorsement data.
--   * fleet_vehicles — the inventory: identity, photo, comprehensive DOT
--     fields (USDOT/MC/GVWR/class/IFTA/annual inspection), hazmat flag,
--     and the assigned driver.
--   * fleet_vehicle_placards — DOT hazard-class placards displayed on the
--     vehicle (49 CFR 172 subpart F).
--   * fleet_vehicle_documents — scanned insurance / registration / DOT-
--     inspection / permit files, with expiry dates the reminder cron reads.
--   * fleet_vehicle_chemicals — ties a hazmat vehicle to the chemical
--     products (and therefore the SDS) it carries, so the Chemical
--     Management / SDS module is the single source of truth for what's
--     on board.
--   * fleet_motor_vehicle_incidents — non-invasive link from a vehicle /
--     driver to an Incident Reporting record, so a crash files through the
--     existing incident lifecycle without forking the schema.
--
-- Storage: a PRIVATE `fleet-docs` bucket holds vehicle photos and scanned
-- documents. Reuses migration 033's storage_path_tenant() helper — every
-- object key's first segment is the tenant UUID, and RLS scopes read +
-- write to members of that tenant (these are sensitive records, so unlike
-- loto-photos the read policy is tenant-scoped, not public).
--
-- Multi-tenancy: tenant_id NOT NULL on every table; the standard
-- active_tenant_id() + current_user_tenant_ids() RLS pattern. Audit +
-- updated_at via the global log_audit() / touch_updated_at() triggers.
--
-- Idempotent — guarded with `if not exists` / drop-before-create.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. fleet_driver_profiles — driver licensing layered onto loto_workers.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_driver_profiles (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references public.tenants(id) on delete cascade,
  -- The person. One driver profile per roster worker per tenant.
  worker_id                     uuid not null references public.loto_workers(id) on delete cascade,

  license_number                text,
  license_class                 text check (license_class is null or license_class in (
                                  'cdl_a','cdl_b','cdl_c','non_cdl','other')),
  license_state                 text,
  license_expires_at            date,
  -- DOT medical examiner's certificate (49 CFR 391.43).
  medical_card_expires_at       date,

  -- Hazmat endorsement (HME) — required to drive placarded hazmat loads.
  hazmat_endorsement            boolean not null default false,
  hazmat_endorsement_expires_at date,
  -- Other CDL endorsements: tanker, doubles_triples, passenger, etc.
  endorsements                  text[] not null default '{}',

  defensive_training_at         date,

  status                        text not null default 'active' check (status in (
                                  'active','suspended','inactive')),
  notes                         text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  created_by                    uuid references public.profiles(id) on delete set null,
  updated_by                    uuid references public.profiles(id) on delete set null,

  unique (tenant_id, worker_id)
);

create index if not exists idx_fleet_driver_profiles_tenant
  on public.fleet_driver_profiles(tenant_id, status);
-- Partial expiry indexes so the daily reminder cron's date-window scan
-- stays cheap as the roster grows (mirrors idx_loto_training_records_expires_at).
create index if not exists idx_fleet_driver_license_expiry
  on public.fleet_driver_profiles(tenant_id, license_expires_at)
  where license_expires_at is not null;
create index if not exists idx_fleet_driver_medical_expiry
  on public.fleet_driver_profiles(tenant_id, medical_card_expires_at)
  where medical_card_expires_at is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. fleet_vehicles — the inventory.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_vehicles (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,

  -- Operator's fleet unit number (e.g. "T-104"). Free-text, unique per
  -- tenant when set so two records for the same truck can't collide.
  unit_number              text,
  make                     text,
  model                    text,
  model_year               int  check (model_year is null or (model_year between 1900 and 2100)),
  vin                      text,
  license_plate            text,
  license_plate_state      text,

  vehicle_type             text not null default 'other' check (vehicle_type in (
                             'car','pickup','van','box_truck','tractor','trailer',
                             'bus','forklift','heavy_equipment','other')),
  status                   text not null default 'active' check (status in (
                             'active','out_of_service','retired')),

  -- Object key in the private `fleet-docs` bucket (NOT a public URL).
  photo_path               text,
  odometer_miles           numeric check (odometer_miles is null or odometer_miles >= 0),

  -- ── Comprehensive DOT identity ──────────────────────────────────────
  usdot_number             text,
  mc_number                text,
  gvwr_lbs                 numeric check (gvwr_lbs is null or gvwr_lbs >= 0),
  -- FHWA gross-vehicle-weight class 1–8.
  dot_vehicle_class        text check (dot_vehicle_class is null or dot_vehicle_class in (
                             '1','2','3','4','5','6','7','8')),
  annual_dot_inspection_at date,
  ifta_registered          boolean not null default false,
  fuel_type                text check (fuel_type is null or fuel_type in (
                             'diesel','gasoline','electric','propane','cng','lng','hybrid','other')),

  -- ── Hazmat ──────────────────────────────────────────────────────────
  carries_hazmat           boolean not null default false,
  hazmat_notes             text,

  assigned_driver_id       uuid references public.fleet_driver_profiles(id) on delete set null,
  home_location_text       text,
  notes                    text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.profiles(id) on delete set null,
  updated_by               uuid references public.profiles(id) on delete set null
);

create index if not exists idx_fleet_vehicles_tenant_status
  on public.fleet_vehicles(tenant_id, status);
create index if not exists idx_fleet_vehicles_assigned_driver
  on public.fleet_vehicles(assigned_driver_id) where assigned_driver_id is not null;
create unique index if not exists uq_fleet_vehicles_unit
  on public.fleet_vehicles(tenant_id, lower(unit_number)) where unit_number is not null;
create unique index if not exists uq_fleet_vehicles_vin
  on public.fleet_vehicles(tenant_id, lower(vin)) where vin is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. fleet_vehicle_placards — DOT hazard-class placards on the vehicle.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_vehicle_placards (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  vehicle_id           uuid not null references public.fleet_vehicles(id) on delete cascade,
  -- DOT hazard class 1–9 (49 CFR 173.2).
  hazard_class         text not null check (hazard_class in ('1','2','3','4','5','6','7','8','9')),
  -- Optional division, e.g. '1.1', '2.1', '5.2'.
  division             text,
  un_number            text,
  proper_shipping_name text,
  placard_label        text,
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.profiles(id) on delete set null,
  updated_by           uuid references public.profiles(id) on delete set null
);

create index if not exists idx_fleet_placards_vehicle
  on public.fleet_vehicle_placards(vehicle_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. fleet_vehicle_documents — scanned insurance / registration / etc.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_vehicle_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  vehicle_id  uuid not null references public.fleet_vehicles(id) on delete cascade,
  doc_type    text not null check (doc_type in (
                'insurance','registration','dot_inspection','ifta','permit','title','other')),
  reference   text,
  issued_at   date,
  expires_at  date,
  -- Object key in the private `fleet-docs` bucket.
  file_path   text,
  file_name   text,
  mime_type   text,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null
);

create index if not exists idx_fleet_documents_vehicle
  on public.fleet_vehicle_documents(vehicle_id, doc_type);
create index if not exists idx_fleet_documents_expiry
  on public.fleet_vehicle_documents(tenant_id, expires_at)
  where expires_at is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 5. fleet_vehicle_chemicals — what hazmat the vehicle carries (→ SDS).
--    References chemical_products so the Chemical Management / SDS module
--    stays the single source of truth for the substance + its SDS.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_vehicle_chemicals (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  vehicle_id          uuid not null references public.fleet_vehicles(id) on delete cascade,
  chemical_product_id uuid not null references public.chemical_products(id) on delete cascade,
  max_quantity        numeric check (max_quantity is null or max_quantity >= 0),
  quantity_unit       text check (quantity_unit is null or quantity_unit in (
                        'gal','lb','kg','L','m3','each')),
  un_number           text,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,

  unique (vehicle_id, chemical_product_id)
);

create index if not exists idx_fleet_vehicle_chemicals_vehicle
  on public.fleet_vehicle_chemicals(vehicle_id);
create index if not exists idx_fleet_vehicle_chemicals_product
  on public.fleet_vehicle_chemicals(chemical_product_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 6. fleet_motor_vehicle_incidents — link a vehicle/driver to an incident.
--    Leaves the incidents schema untouched; a road incident files through
--    the existing Incident Reporting lifecycle and this row joins it back
--    to the fleet record. journey_id is a soft ref (fleet_journeys lands
--    in Phase 3).
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_motor_vehicle_incidents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  vehicle_id  uuid references public.fleet_vehicles(id) on delete set null,
  driver_id   uuid references public.fleet_driver_profiles(id) on delete set null,
  journey_id  uuid,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,

  unique (incident_id)
);

create index if not exists idx_fleet_mvi_vehicle
  on public.fleet_motor_vehicle_incidents(vehicle_id) where vehicle_id is not null;
create index if not exists idx_fleet_mvi_incident
  on public.fleet_motor_vehicle_incidents(incident_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 7. updated_at + audit triggers (global helpers).
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'fleet_driver_profiles','fleet_vehicles','fleet_vehicle_placards',
    'fleet_vehicle_documents','fleet_vehicle_chemicals','fleet_motor_vehicle_incidents'
  ]
  loop
    execute format('drop trigger if exists trg_%1$s_touch_updated_at on public.%1$s;', t);
    execute format('create trigger trg_%1$s_touch_updated_at before update on public.%1$s
                      for each row execute function public.touch_updated_at();', t);
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$s;', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
                      for each row execute function public.log_audit();', t);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 8. Row-Level Security — standard tenant-scope on every table.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'fleet_driver_profiles','fleet_vehicles','fleet_vehicle_placards',
    'fleet_vehicle_documents','fleet_vehicle_chemicals','fleet_motor_vehicle_incidents'
  ]
  loop
    execute format('alter table public.%1$s enable row level security;', t);
    execute format('drop policy if exists %1$s_tenant_scope on public.%1$s;', t);
    execute format($p$
      create policy %1$s_tenant_scope on public.%1$s
        for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        )
        with check (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        );
    $p$, t);
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 9. Private storage bucket for vehicle photos + scanned documents.
--    First path segment = tenant UUID (reuses storage_path_tenant from 033).
-- ──────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fleet-docs',
  'fleet-docs',
  false,
  26214400,  -- 25 MB
  array['image/jpeg','image/png','image/webp','application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public             = excluded.public;

drop policy if exists "fleet_docs_tenant_select" on storage.objects;
drop policy if exists "fleet_docs_tenant_insert" on storage.objects;
drop policy if exists "fleet_docs_tenant_update" on storage.objects;
drop policy if exists "fleet_docs_tenant_delete" on storage.objects;

create policy "fleet_docs_tenant_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fleet-docs'
    and (public.is_superadmin()
         or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  );

create policy "fleet_docs_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fleet-docs'
    and (public.is_superadmin()
         or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  );

create policy "fleet_docs_tenant_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fleet-docs'
    and (public.is_superadmin()
         or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  )
  with check (
    bucket_id = 'fleet-docs'
    and (public.is_superadmin()
         or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  );

create policy "fleet_docs_tenant_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fleet-docs'
    and (public.is_superadmin()
         or public.storage_path_tenant(name) in (select public.current_user_tenant_ids()))
  );

notify pgrst, 'reload schema';

commit;
