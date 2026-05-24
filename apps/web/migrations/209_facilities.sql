-- Migration 209: facilities — a per-tenant registry of physical sites.
--
-- A "client" is a tenants row (migrations 027-029). Until now every domain
-- table was scoped ONLY by tenant_id, so a client that operates more than one
-- physical facility had all of its equipment, permits, incidents, etc. in a
-- single flat bucket. This migration introduces the facility dimension BENEATH
-- the tenant: one tenant -> many facilities.
--
-- The design mirrors the proven tenant-scoping machinery so reads and most
-- inserts stay transparent:
--   - prop65_sites (migration 172) is the table/trigger/RLS template.
--   - active_facility_id() mirrors active_tenant_id() (migration 032): it reads
--     the x-active-facility request header and returns NULL outside PostgREST
--     (cron / service-role / migrations), which is what makes those paths
--     immune to facility scoping.
--
-- Facility-scoping of the domain tables themselves (the facility_id columns and
-- the RLS rewrite) lands in migrations 210 + 211. This migration is purely
-- additive and non-breaking.
--
-- Idempotent.

begin;

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────
-- facilities — one row per physical site, scoped to its tenant
--
-- is_primary   the tenant's default facility. Exactly one per tenant
--              (enforced by the partial unique index below). The backfill
--              at the end of this migration mints one per existing tenant.
-- code         optional short human handle ('PLANT-A'); unique within a
--              tenant when present.
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.facilities (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  name         text        not null check (length(btrim(name)) > 0),
  code         text        check (code is null or length(btrim(code)) > 0),
  address      text,
  city         text,
  state        text        check (state is null or length(btrim(state)) > 0),
  is_primary   boolean     not null default false,
  status       text        not null default 'active'
                 check (status in ('active', 'archived')),
  settings     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_facilities_tenant
  on public.facilities (tenant_id, name);

-- At most one primary facility per tenant.
create unique index if not exists uq_facilities_one_primary_per_tenant
  on public.facilities (tenant_id) where is_primary;

comment on table public.facilities is
  'Per-tenant registry of physical facilities/sites. Domain rows carry a facility_id (migrations 210/211) scoped to one of these; NULL facility_id = shared across all of the tenant''s facilities.';

drop trigger if exists trg_facilities_touch on public.facilities;
create trigger trg_facilities_touch
  before update on public.facilities
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_facilities on public.facilities;
create trigger trg_audit_facilities
  after insert or update or delete on public.facilities
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────
-- active_facility_id() — read the x-active-facility request header.
--
-- Verbatim mirror of public.active_tenant_id() (migration 032). Returns
-- NULL when no header was sent (or the JSON parse fails). That NULL is
-- the "roll-up" signal: domain-table RLS (migration 211) shows ALL of the
-- tenant's facilities when this is NULL, and narrows to the one facility
-- when it is set. It is also what immunizes cron / supabaseAdmin /
-- migrations, which never carry the header.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.active_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true),
      ''
    )::jsonb ->> 'x-active-facility',
    ''
  )::uuid
$$;

comment on function public.active_facility_id() is
  'The facility_id from the x-active-facility request header, or NULL when no header was sent. NULL = roll-up (all facilities in the active tenant). Used by domain-table RLS in migration 211.';

-- ────────────────────────────────────────────────────────────────────
-- RLS — tenant scope only.
--
-- Facilities are NOT facility-scoped (you must see all of a tenant's
-- facilities to pick one). Header + membership predicate copied from
-- prop65_sites_tenant_scope (migration 172).
-- ────────────────────────────────────────────────────────────────────
alter table public.facilities enable row level security;

drop policy if exists "facilities_tenant_scope" on public.facilities;
create policy "facilities_tenant_scope"
  on public.facilities
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

-- ────────────────────────────────────────────────────────────────────
-- Backfill — one primary facility per existing tenant.
--
-- Named after the tenant. Idempotent: skips any tenant that already has a
-- facility, so re-running won't create duplicates.
-- ────────────────────────────────────────────────────────────────────
insert into public.facilities (tenant_id, name, is_primary)
select t.id,
       coalesce(nullif(btrim(t.name), ''), 'Main Facility'),
       true
  from public.tenants t
 where not exists (
   select 1 from public.facilities f where f.tenant_id = t.id
 );

notify pgrst, 'reload schema';

commit;
