-- Migration 299: environmental site profiles + facilities.state as a USPS code.
--
-- A site profile records which environmental programs a facility is subject to
-- (stormwater coverage, air permit class, wastewater discharge, SPCC, Tier II).
-- It is what the compliance library keys off: the checklists, deadlines and legal
-- register entries a site is offered follow from it. Every axis starts at
-- 'not_evaluated': the product never assumes a plant is, or is not, subject to a
-- program. Generator status stays with the hazardous waste module.
--
-- facilities.state is already read as a USPS code (the OSHA severe-injury
-- reporting window), but nothing constrained it. Saving a site's state from the
-- environmental screens also sets that reporting jurisdiction: that is correct,
-- and the screen says so. The constraint is NOT VALID: existing rows are left
-- alone (a bad old value is not rewritten), new and changed rows must conform.
--
-- Access: members read their facility's profile; tenant admins write it.
-- Facility scoping follows migration 211 (header narrows to a facility, no header
-- is the roll-up). The (tenant_id, facility_id) pair is a composite foreign key,
-- so the database itself guarantees a profile's tenant and facility belong
-- together (uq_facilities_tenant_id_pair, migration 284).
--
-- Idempotent. Rollback: 299_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.facilities'::regclass and conname = 'facilities_state_usps_check'
  ) then
    alter table public.facilities
      add constraint facilities_state_usps_check check (state is null or state ~ '^[A-Z]{2}$') not valid;
  end if;
end $$;

create table if not exists public.environmental_site_profiles (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  facility_id               uuid not null,

  stormwater_coverage       text not null default 'not_evaluated'
                              check (stormwater_coverage in ('not_evaluated','not_required','no_exposure','general_permit','individual_permit')),
  -- Which general permit, e.g. 'ca_igp', 'tx_txr05', 'epa_msgp'.
  stormwater_general_permit text check (stormwater_general_permit is null or stormwater_general_permit ~ '^[a-z0-9_]{2,40}$'),
  sic_codes                 text[] not null default '{}' check (cardinality(sic_codes) <= 20),
  naics_codes               text[] not null default '{}' check (cardinality(naics_codes) <= 20),

  air_permit_type           text not null default 'not_evaluated'
                              check (air_permit_type in ('not_evaluated','not_required','exempt','registration_or_pbr','minor_permit','synthetic_minor','title_v')),
  wastewater_discharge      text not null default 'not_evaluated'
                              check (wastewater_discharge in ('not_evaluated','none','potw_indirect','npdes_direct','zero_discharge','septic')),
  pretreatment_status       text not null default 'not_evaluated'
                              check (pretreatment_status in ('not_evaluated','not_regulated','non_significant','siu','ciu')),
  potw_name                 text check (potw_name is null or length(potw_name) <= 200),
  -- { air_district, cupa, regional_board, potw }
  local_agencies            jsonb not null default '{}'::jsonb check (jsonb_typeof(local_agencies) = 'object'),

  -- null = not yet evaluated.
  spcc_applicable           boolean,
  tier2_applicable          boolean,
  notes                     text check (notes is null or length(notes) <= 2000),

  confirmed_at              timestamptz,
  confirmed_by              uuid references public.profiles(id) on delete set null,

  created_at                timestamptz not null default now(),
  created_by                uuid references public.profiles(id) on delete set null,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.profiles(id) on delete set null,

  unique (facility_id),
  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade,
  -- A general-permit key only means something when coverage is a general permit.
  check (stormwater_general_permit is null or stormwater_coverage = 'general_permit')
);

create index if not exists idx_env_site_profiles_tenant on public.environmental_site_profiles (tenant_id);

drop trigger if exists trg_env_site_profiles_touch on public.environmental_site_profiles;
create trigger trg_env_site_profiles_touch
  before update on public.environmental_site_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_env_site_profiles on public.environmental_site_profiles;
create trigger trg_audit_env_site_profiles
  after insert or update or delete on public.environmental_site_profiles
  for each row execute function public.log_audit('id');

alter table public.environmental_site_profiles enable row level security;

drop policy if exists env_site_profiles_read on public.environmental_site_profiles;
create policy env_site_profiles_read on public.environmental_site_profiles
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists env_site_profiles_admin_write on public.environmental_site_profiles;
create policy env_site_profiles_admin_write on public.environmental_site_profiles
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
