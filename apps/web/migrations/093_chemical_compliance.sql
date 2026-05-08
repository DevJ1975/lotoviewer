-- Migration 086: chemical compliance rollups (Phase F).
--
-- Three concerns layered on top of the catalog + inventory module:
--
--   1. chemical_exposure_events — links incidents to chemicals so an
--      OSHA 300 logger can find the agent involved + the exposure
--      route + duration. One incident → many events (a spill can
--      affect several workers via different routes).
--
--   2. chemical_max_allowable_quantities — per-(tenant, location)
--      caps for fire-code MAQ rollups. Storage_class match drives
--      the limit (NFPA 30 flammable, etc.).
--
--   3. v_chemical_tier_two — EPCRA Tier II rollup of the active
--      inventory by product + location. Average and max daily
--      quantity at each site over the last 365 days. Single source
--      of truth for the Tier II CSV export.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. chemical_exposure_events
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.chemical_exposure_events (
  id            uuid not null primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  incident_id   uuid not null references public.incidents(id) on delete cascade,
  product_id    uuid not null references public.chemical_products(id) on delete restrict,
  -- Optional link to the specific container that caused the exposure
  -- (when known). Sets to NULL if the container is later disposed,
  -- but the product_id link is preserved.
  inventory_item_id uuid references public.chemical_inventory_items(id) on delete set null,

  -- Optional link to the affected worker (FK to incident_people).
  person_id     uuid references public.incident_people(id) on delete set null,

  -- Route per OSHA / NIOSH categorization.
  route         text not null check (route in (
    'inhalation', 'skin_absorption', 'eye_contact',
    'ingestion', 'injection', 'unknown')),

  -- Free text quantity + unit; users frequently estimate in field
  -- ("a few drops", "approx 1 cup") so we don't enforce a number.
  estimated_quantity text,
  exposure_duration_minutes integer
    check (exposure_duration_minutes is null or exposure_duration_minutes >= 0),

  -- Severity matches the OSHA 301 / first-aid taxonomy. NULL for
  -- "documented but no symptoms / non-injury exposure".
  severity      text check (severity in (
    'first_aid', 'medical_treatment', 'lost_time', 'fatality', 'no_symptoms')),

  ppe_in_use    text[] not null default '{}'::text[],

  -- Air-monitoring readout when available. ppm is the most useful
  -- single field; the SDS PEL/STEL on the chemical row puts it in
  -- context.
  measured_ppm  numeric,

  notes         text,

  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

create index if not exists idx_chem_exposure_tenant
  on public.chemical_exposure_events(tenant_id);
create index if not exists idx_chem_exposure_incident
  on public.chemical_exposure_events(incident_id);
create index if not exists idx_chem_exposure_product
  on public.chemical_exposure_events(product_id, created_at desc);

drop trigger if exists trg_chem_exposure_touch on public.chemical_exposure_events;
create trigger trg_chem_exposure_touch
  before update on public.chemical_exposure_events
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. chemical_max_allowable_quantities
-- ──────────────────────────────────────────────────────────────────────────
--
-- Tenant-defined caps for fire-code MAQ tracking. Match by storage_class
-- (default) or by individual product_id (override). The dashboard +
-- Tier II report flag locations whose summed quantity exceeds the cap.

create table if not exists public.chemical_max_allowable_quantities (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  location_id  uuid references public.chemical_locations(id) on delete cascade,

  -- One rule must match by EITHER storage_class OR product_id; the
  -- check enforces exactly one is set.
  storage_class text,
  product_id    uuid references public.chemical_products(id) on delete cascade,

  unit          text not null check (unit in (
    'gal', 'L', 'mL', 'kg', 'g', 'lb', 'oz', 'ea')),
  max_quantity  numeric not null check (max_quantity > 0),
  reference     text,            -- e.g. "IFC 2018 Table 5003.1.1(1)"

  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),

  check (
    (storage_class is not null and product_id is null)
    or (storage_class is null and product_id is not null)
  )
);

create index if not exists idx_chem_maq_tenant
  on public.chemical_max_allowable_quantities(tenant_id);
create index if not exists idx_chem_maq_location
  on public.chemical_max_allowable_quantities(location_id)
  where location_id is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. v_chemical_tier_two — EPCRA Tier II rollup
-- ──────────────────────────────────────────────────────────────────────────
--
-- Tier II requires reporting any hazardous chemical kept above
-- threshold (typically 10 000 lb / 500 lb for EHS) over the calendar
-- year. We surface ALL active inventory grouped by (product, location)
-- so the operator can filter to threshold candidates inside the UI.
-- Average and max daily are approximated from the current quantity
-- (Phase F1); a future Phase F2 can replace this with a daily-snapshot
-- log driven by a cron + view union.
--
-- Quantities are summed in their stored unit AS-IS. The report UI is
-- responsible for unit conversion when comparing across containers.

create or replace view public.v_chemical_tier_two
  with (security_invoker = true)
  as
  select
    i.tenant_id,
    p.id              as product_id,
    p.name            as product_name,
    p.manufacturer,
    p.cas_numbers,
    p.storage_class,
    p.physical_state,
    p.ghs_signal_word,
    p.ghs_pictograms,
    l.id              as location_id,
    l.name            as location_name,
    l.path            as location_path,
    i.unit,
    sum(i.quantity)::numeric        as total_quantity,
    -- For Tier II the max-daily is the largest single-day total
    -- the tenant ever held; with only a snapshot today, we report
    -- the current sum. Replace when daily snapshots ship.
    sum(i.quantity)::numeric        as max_daily_quantity,
    sum(i.quantity)::numeric        as average_daily_quantity,
    count(*)::int                   as container_count,
    min(i.expiration_date)          as earliest_expiration
  from public.chemical_inventory_items i
  join public.chemical_products  p on p.id = i.product_id
  left join public.chemical_locations l on l.id = i.location_id
  where i.status in ('in_stock', 'in_use', 'quarantined')
    and (p.archived_at is null)
  group by i.tenant_id, p.id, p.name, p.manufacturer, p.cas_numbers,
           p.storage_class, p.physical_state, p.ghs_signal_word, p.ghs_pictograms,
           l.id, l.name, l.path, i.unit;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────────

alter table public.chemical_exposure_events            enable row level security;
alter table public.chemical_max_allowable_quantities   enable row level security;

drop policy if exists chem_exposure_tenant on public.chemical_exposure_events;
create policy chem_exposure_tenant on public.chemical_exposure_events
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

drop policy if exists chem_maq_tenant on public.chemical_max_allowable_quantities;
create policy chem_maq_tenant on public.chemical_max_allowable_quantities
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
