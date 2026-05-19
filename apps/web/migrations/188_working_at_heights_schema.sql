-- Migration 188: Working at Heights inventory schema.
--
-- Eight new tables back the inventory + permit + inspection surfaces
-- the admin UI consumes:
--
--   wah_authorizations   — per-worker role designations (Authorized /
--                          Competent / Qualified Person) with validity
--                          windows. Read by the permit pre-check.
--   wah_components       — every serialised PFAS item (harness,
--                          lanyard, SRL, anchor connector, rope grab,
--                          trauma strap, RDD). Drives inspection cycle
--                          enforcement and the service-life expiry
--                          dashboard.
--   wah_ladders_portable — ANSI A14-rated portable ladders.
--   wah_ladders_fixed    — fixed ladders with the 2036 cage phase-out
--                          retrofit fields baked in.
--   wah_anchors          — engineered + improvised anchor points with
--                          QP certification metadata + recert cycle.
--   wah_rescue_plans     — per-location rescue plans (the most-cited
--                          fall protection gap); links to its rescue
--                          descent device component.
--   wah_inspections      — polymorphic inspection rows (component /
--                          portable ladder / fixed ladder / anchor),
--                          covering pre-use, periodic, and post-event.
--   wah_permits          — Working-at-Heights permit issuance. Phase
--                          4 builds the issuance workflow; the schema
--                          lands here so the other tables can FK to
--                          it without a follow-up migration churn.
--
-- RLS posture mirrors the existing identity surfaces:
--   - SELECT to authenticated members of the tenant
--   - INSERT / UPDATE / DELETE to tenant admins only
--   - Superadmin overrides via public.is_superadmin()
--
-- Audit triggers attach via public.log_audit('id') — same pattern the
-- LOTO + BBS + Hot Work tables use, so the existing audit log surface
-- sees Working at Heights writes immediately.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Enum types
-- ─────────────────────────────────────────────────────────────────────────

do $$ begin
  create type public.wah_role as enum ('authorized', 'competent', 'qualified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_component_type as enum (
    'harness',
    'shock_lanyard',
    'positioning_lanyard',
    'restraint_lanyard',
    'srl_class1',
    'srl_class2',
    'anchor_connector',
    'rope_grab',
    'trauma_strap',
    'rescue_descent_device'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_equipment_status as enum (
    'in_service',
    'quarantined',
    'condemned',
    'in_rescue_cache',
    'pending_recert'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_ladder_type as enum ('extension', 'step', 'articulated', 'mobile');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_ladder_material as enum ('aluminum', 'fiberglass', 'wood', 'composite');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_ladder_duty as enum ('IAA', 'IA', 'I', 'II', 'III');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_anchor_kind as enum (
    'engineered_permanent',
    'engineered_portable',
    'horizontal_lifeline',
    'improvised'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_inspection_kind as enum ('pre_use', 'periodic', 'post_event');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_inspection_outcome as enum ('pass', 'concern', 'condemn');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.wah_permit_status as enum ('active', 'completed', 'suspended', 'cancelled');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. wah_authorizations
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_authorizations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  role            public.wah_role not null,
  -- Scope is the regulatory boundary of the designation. "general
  -- industry fall protection", "rope access rescue Levels 1-2",
  -- "engineered anchorage design" — a CP's authorisation is task-
  -- scoped, not blanket.
  scope           text,
  -- Training certificate stored in Supabase Storage. Stored as a path
  -- (bucket-relative) so a signed URL can be minted at read time.
  certificate_url text,
  -- PE license number applies only to Qualified Persons. Validated
  -- by application code, not the schema, because licence formats vary
  -- by state.
  qp_pe_license   text,
  valid_from      date not null,
  valid_until     date not null,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint wah_auth_valid_dates check (valid_until >= valid_from)
);

create index if not exists idx_wah_auth_tenant
  on public.wah_authorizations(tenant_id);
create index if not exists idx_wah_auth_member
  on public.wah_authorizations(member_id);
-- Expiring-soon dashboard: 90-day window query is a common operator
-- read. Partial index on still-valid rows keeps it tight.
create index if not exists idx_wah_auth_expiring
  on public.wah_authorizations(tenant_id, valid_until)
  where valid_until >= current_date;

alter table public.wah_authorizations enable row level security;

drop policy if exists wah_auth_member_read on public.wah_authorizations;
create policy wah_auth_member_read on public.wah_authorizations
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_auth_admin_write on public.wah_authorizations;
create policy wah_auth_admin_write on public.wah_authorizations
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_auth on public.wah_authorizations;
create trigger trg_audit_wah_auth
  after insert or update or delete on public.wah_authorizations
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 3. wah_components
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_components (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  type                        public.wah_component_type not null,
  manufacturer                text not null,
  model                       text,
  serial                      text not null,
  mfg_date                    date,
  first_used_date             date,
  -- Service life in years from manufacturer documentation. NULL =
  -- use the default for the component type. Stored explicitly so
  -- the calculator can show the source of the expiry.
  service_life_years          smallint,
  -- Computed at write time by app code; stored so expiry-window
  -- queries don't need a function call.
  service_expires_at          date,
  assigned_to_member_id       uuid references public.members(id) on delete set null,
  storage_location            text,
  status                      public.wah_equipment_status not null default 'in_service',
  status_reason               text,
  status_photo_url            text,
  last_pre_use_inspection_at  timestamptz,
  last_periodic_inspection_at timestamptz,
  last_periodic_inspector_id  uuid references public.members(id) on delete set null,
  notes                       text,
  metadata                    jsonb not null default '{}'::jsonb,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, type, serial)
);

create index if not exists idx_wah_components_tenant
  on public.wah_components(tenant_id);
create index if not exists idx_wah_components_assigned
  on public.wah_components(tenant_id, assigned_to_member_id)
  where assigned_to_member_id is not null;
create index if not exists idx_wah_components_status
  on public.wah_components(tenant_id, status);
create index if not exists idx_wah_components_expiring
  on public.wah_components(tenant_id, service_expires_at)
  where service_expires_at is not null and status = 'in_service';

alter table public.wah_components enable row level security;

drop policy if exists wah_components_member_read on public.wah_components;
create policy wah_components_member_read on public.wah_components
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_components_admin_write on public.wah_components;
create policy wah_components_admin_write on public.wah_components
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_components on public.wah_components;
create trigger trg_audit_wah_components
  after insert or update or delete on public.wah_components
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 4. wah_ladders_portable
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_ladders_portable (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  asset_tag                   text,
  ladder_type                 public.wah_ladder_type not null,
  material                    public.wah_ladder_material not null,
  duty_rating                 public.wah_ladder_duty not null,
  max_capacity_lbf            smallint,
  manufacturer                text,
  model                       text,
  serial                      text,
  height_ft                   numeric(5,1),
  purchase_date               date,
  storage_location            text,
  status                      public.wah_equipment_status not null default 'in_service',
  status_reason               text,
  last_pre_use_inspection_at  timestamptz,
  last_periodic_inspection_at timestamptz,
  last_periodic_inspector_id  uuid references public.members(id) on delete set null,
  notes                       text,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, asset_tag)
);

create index if not exists idx_wah_ladders_portable_tenant
  on public.wah_ladders_portable(tenant_id);
create index if not exists idx_wah_ladders_portable_status
  on public.wah_ladders_portable(tenant_id, status);

alter table public.wah_ladders_portable enable row level security;

drop policy if exists wah_ladders_portable_member_read on public.wah_ladders_portable;
create policy wah_ladders_portable_member_read on public.wah_ladders_portable
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_ladders_portable_admin_write on public.wah_ladders_portable;
create policy wah_ladders_portable_admin_write on public.wah_ladders_portable
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_ladders_portable on public.wah_ladders_portable;
create trigger trg_audit_wah_ladders_portable
  after insert or update or delete on public.wah_ladders_portable
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 5. wah_ladders_fixed
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_ladders_fixed (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  asset_tag                   text,
  location_label              text not null,
  drawing_ref                 text,
  height_ft                   numeric(6,1) not null,
  has_cage                    boolean not null default false,
  has_ladder_safety_system    boolean not null default false,
  ladder_safety_system_serial text,
  -- Fixed ladders ≥24 ft installed before 2018 must have a ladder
  -- safety system OR PFAS by November 18, 2036. Cage-only is the
  -- defaulted-target column; auditors will ask for this date.
  retrofit_target_date        date,
  last_periodic_inspection_at timestamptz,
  last_periodic_inspector_id  uuid references public.members(id) on delete set null,
  status                      public.wah_equipment_status not null default 'in_service',
  notes                       text,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_wah_ladders_fixed_tenant
  on public.wah_ladders_fixed(tenant_id);
-- 2036-retrofit reporting: list ladders without a safety system,
-- sorted by target date.
create index if not exists idx_wah_ladders_fixed_retrofit
  on public.wah_ladders_fixed(tenant_id, retrofit_target_date)
  where has_ladder_safety_system = false;

alter table public.wah_ladders_fixed enable row level security;

drop policy if exists wah_ladders_fixed_member_read on public.wah_ladders_fixed;
create policy wah_ladders_fixed_member_read on public.wah_ladders_fixed
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_ladders_fixed_admin_write on public.wah_ladders_fixed;
create policy wah_ladders_fixed_admin_write on public.wah_ladders_fixed
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_ladders_fixed on public.wah_ladders_fixed;
create trigger trg_audit_wah_ladders_fixed
  after insert or update or delete on public.wah_ladders_fixed
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 6. wah_anchors
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_anchors (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  asset_tag                   text,
  location_label              text not null,
  kind                        public.wah_anchor_kind not null,
  -- Default OSHA requirement is 5,000 lbf per worker. Engineered
  -- alternative is 2x peak arrest force (typically 3,600 lbf).
  rated_capacity_lbf          integer not null,
  workers_max                 smallint not null default 1
                              check (workers_max >= 1),
  qp_name                     text,
  qp_pe_license               text,
  qp_certified_at             date,
  recertification_due_at      date,
  drawing_ref                 text,
  installation_date           date,
  last_inspected_at           timestamptz,
  last_inspector_id           uuid references public.members(id) on delete set null,
  status                      public.wah_equipment_status not null default 'in_service',
  notes                       text,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, asset_tag)
);

create index if not exists idx_wah_anchors_tenant
  on public.wah_anchors(tenant_id);
create index if not exists idx_wah_anchors_recert_due
  on public.wah_anchors(tenant_id, recertification_due_at)
  where recertification_due_at is not null and status = 'in_service';

alter table public.wah_anchors enable row level security;

drop policy if exists wah_anchors_member_read on public.wah_anchors;
create policy wah_anchors_member_read on public.wah_anchors
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_anchors_admin_write on public.wah_anchors;
create policy wah_anchors_admin_write on public.wah_anchors
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_anchors on public.wah_anchors;
create trigger trg_audit_wah_anchors
  after insert or update or delete on public.wah_anchors
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 7. wah_rescue_plans
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_rescue_plans (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  location_label              text not null,
  primary_rescuer_id          uuid references public.members(id) on delete set null,
  backup_rescuer_id           uuid references public.members(id) on delete set null,
  -- Equipment cache is a JSON array of { component_id, role } so the
  -- plan can name specific serials when relevant (e.g. THIS RDD is
  -- staged in THIS cabinet for THIS plan).
  equipment_cache             jsonb not null default '[]'::jsonb,
  evacuation_route_photo_url  text,
  contact_911_protocol        text,
  last_drilled_at             date,
  next_drill_due              date,
  notes                       text,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_wah_rescue_plans_tenant
  on public.wah_rescue_plans(tenant_id);
create index if not exists idx_wah_rescue_plans_drill_due
  on public.wah_rescue_plans(tenant_id, next_drill_due)
  where next_drill_due is not null;

alter table public.wah_rescue_plans enable row level security;

drop policy if exists wah_rescue_plans_member_read on public.wah_rescue_plans;
create policy wah_rescue_plans_member_read on public.wah_rescue_plans
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_rescue_plans_admin_write on public.wah_rescue_plans;
create policy wah_rescue_plans_admin_write on public.wah_rescue_plans
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_rescue_plans on public.wah_rescue_plans;
create trigger trg_audit_wah_rescue_plans
  after insert or update or delete on public.wah_rescue_plans
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 8. wah_inspections (polymorphic across the four inventory tables)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_inspections (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  -- Polymorphic target: exactly one of these is non-null. CHECK
  -- constraint below enforces.
  component_id        uuid references public.wah_components(id) on delete cascade,
  ladder_portable_id  uuid references public.wah_ladders_portable(id) on delete cascade,
  ladder_fixed_id     uuid references public.wah_ladders_fixed(id) on delete cascade,
  anchor_id           uuid references public.wah_anchors(id) on delete cascade,
  inspector_id        uuid not null references public.members(id) on delete cascade,
  kind                public.wah_inspection_kind not null,
  outcome             public.wah_inspection_outcome not null,
  -- Findings is a free-form JSON envelope so the per-component-type
  -- inspection checklists can evolve without a migration. Example:
  --   { "webbing": "ok", "stitching": "concern: frayed at chest D-ring", ... }
  findings            jsonb not null default '{}'::jsonb,
  photo_urls          text[] not null default '{}',
  notes               text,
  performed_at        timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint wah_inspection_target_xor check (
    (case when component_id       is not null then 1 else 0 end) +
    (case when ladder_portable_id is not null then 1 else 0 end) +
    (case when ladder_fixed_id    is not null then 1 else 0 end) +
    (case when anchor_id          is not null then 1 else 0 end)
    = 1
  )
);

create index if not exists idx_wah_inspections_tenant_time
  on public.wah_inspections(tenant_id, performed_at desc);
create index if not exists idx_wah_inspections_component
  on public.wah_inspections(component_id, performed_at desc)
  where component_id is not null;
create index if not exists idx_wah_inspections_anchor
  on public.wah_inspections(anchor_id, performed_at desc)
  where anchor_id is not null;
create index if not exists idx_wah_inspections_ladder_portable
  on public.wah_inspections(ladder_portable_id, performed_at desc)
  where ladder_portable_id is not null;
create index if not exists idx_wah_inspections_ladder_fixed
  on public.wah_inspections(ladder_fixed_id, performed_at desc)
  where ladder_fixed_id is not null;

alter table public.wah_inspections enable row level security;

drop policy if exists wah_inspections_member_read on public.wah_inspections;
create policy wah_inspections_member_read on public.wah_inspections
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

-- Pre-use inspections are worker-authored; any member of the tenant
-- can record one. Periodic + post-event require admin (the CP is the
-- inspector of record on those; this is the database-level fence in
-- addition to the API gate).
drop policy if exists wah_inspections_member_insert on public.wah_inspections;
create policy wah_inspections_member_insert on public.wah_inspections
  for insert to authenticated
  with check (
    (kind = 'pre_use' and tenant_id in (select public.current_user_tenant_ids()))
    or (kind in ('periodic', 'post_event') and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    ))
  );

drop policy if exists wah_inspections_admin_modify on public.wah_inspections;
create policy wah_inspections_admin_modify on public.wah_inspections
  for update to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop policy if exists wah_inspections_admin_delete on public.wah_inspections;
create policy wah_inspections_admin_delete on public.wah_inspections
  for delete to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_inspections on public.wah_inspections;
create trigger trg_audit_wah_inspections
  after insert or update or delete on public.wah_inspections
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- 9. wah_permits (schema only; Phase 4 builds the issuance workflow)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.wah_permits (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  permit_number               text not null,
  work_location               text not null,
  task_description            text,
  worker_id                   uuid not null references public.members(id) on delete cascade,
  cp_id                       uuid not null references public.members(id) on delete cascade,
  anchor_id                   uuid references public.wah_anchors(id) on delete set null,
  -- Components used on the task — array of wah_components.id. App
  -- code reads these to validate service-life expiry + last-inspection
  -- preconditions at issue time.
  components_used             uuid[] not null default '{}',
  rescue_plan_id              uuid references public.wah_rescue_plans(id) on delete set null,
  -- JSON snapshot of the clearance calculator output at issue time.
  -- Stored so an auditor can see the math that proved the system fit
  -- the location; recomputing later may give a different answer if
  -- component defaults shifted.
  clearance_calculation       jsonb,
  weather_check               jsonb,
  jha_id                      uuid,                  -- JHA module reference; intentionally untyped here
  valid_from                  timestamptz not null,
  valid_until                 timestamptz not null,
  status                      public.wah_permit_status not null default 'active',
  closed_at                   timestamptz,
  closed_by                   uuid references auth.users(id) on delete set null,
  notes                       text,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  unique (tenant_id, permit_number),
  constraint wah_permit_valid_dates check (valid_until > valid_from)
);

create index if not exists idx_wah_permits_tenant
  on public.wah_permits(tenant_id);
create index if not exists idx_wah_permits_active
  on public.wah_permits(tenant_id, valid_until)
  where status = 'active';
create index if not exists idx_wah_permits_anchor
  on public.wah_permits(anchor_id) where anchor_id is not null;

alter table public.wah_permits enable row level security;

drop policy if exists wah_permits_member_read on public.wah_permits;
create policy wah_permits_member_read on public.wah_permits
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_tenant_ids())
  );

drop policy if exists wah_permits_admin_write on public.wah_permits;
create policy wah_permits_admin_write on public.wah_permits
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

drop trigger if exists trg_audit_wah_permits on public.wah_permits;
create trigger trg_audit_wah_permits
  after insert or update or delete on public.wah_permits
  for each row execute function public.log_audit('id');

-- ─────────────────────────────────────────────────────────────────────────
-- PostgREST: refresh schema cache so the new tables surface immediately
-- via the supabase-js client.
-- ─────────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';

commit;
