-- Migration 300: environmental permits and stormwater/discharge outfalls.
--
-- environmental_permits holds each permit a facility works under (an industrial
-- stormwater general permit coverage, an air permit to operate, a wastewater
-- discharge permit) with its dates, so the calendar can carry a renewal deadline
-- and a permit that lapses shows on the home screen. Conditions and identifiers
-- (a WDID, a STEERS authorization number) are kept as structured data.
--
-- stormwater_outfalls lists a facility's discharge points: the thing outfall
-- checklists are run against.
--
-- Access: members read, tenant admins write. Facility scoping as in 211. The
-- (tenant_id, facility_id) pair is a composite foreign key (see 299).
--
-- Idempotent. Rollback: 300_rollback.sql.

begin;

create table if not exists public.environmental_permits (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  facility_id       uuid not null,

  program           text not null check (program in ('stormwater','air','wastewater','hazardous_waste','spcc','other')),
  permit_type       text not null check (length(btrim(permit_type)) between 1 and 200),
  permit_number     text check (permit_number is null or length(permit_number) <= 100),
  issuing_agency    text check (issuing_agency is null or length(issuing_agency) <= 200),
  -- 'federal', or a USPS state code.
  jurisdiction      text check (jurisdiction is null or jurisdiction ~ '^(federal|[A-Z]{2})$'),

  status            text not null default 'draft'
                      check (status in ('draft','application_pending','active','expired','terminated','not_required')),
  effective_date    date,
  expiration_date   date,
  -- How many days before expiration the renewal application is due. The user's
  -- own safety margin: the permit itself says what its agency requires.
  renewal_lead_days int not null default 180 check (renewal_lead_days between 0 and 1095),

  -- { wdid, steers_authorization, ... }
  identifiers       jsonb not null default '{}'::jsonb check (jsonb_typeof(identifiers) = 'object'),
  -- [{ id, text, frequency, ref }]
  conditions        jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  -- Object key in the private environmental-evidence bucket (migration 301).
  document_path     text check (document_path is null or length(document_path) <= 300),
  notes             text check (notes is null or length(notes) <= 2000),

  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id) on delete set null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id) on delete set null,

  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade,
  check (effective_date is null or expiration_date is null or expiration_date >= effective_date),
  unique (tenant_id, facility_id, program, permit_number)
);

create index if not exists idx_env_permits_facility on public.environmental_permits (tenant_id, facility_id, status);
create index if not exists idx_env_permits_expiry on public.environmental_permits (tenant_id, expiration_date)
  where status = 'active' and expiration_date is not null;

create table if not exists public.stormwater_outfalls (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  facility_id                 uuid not null,
  permit_id                   uuid references public.environmental_permits(id) on delete set null,

  code                        text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$'),
  name                        text check (name is null or length(name) <= 200),
  receiving_water             text check (receiving_water is null or length(receiving_water) <= 200),
  drainage_area               text check (drainage_area is null or length(drainage_area) <= 500),
  latitude                    numeric(9,6) check (latitude is null or latitude between -90 and 90),
  longitude                   numeric(9,6) check (longitude is null or longitude between -180 and 180),
  outfall_type                text not null default 'stormwater' check (outfall_type in ('stormwater','authorized_nsw','combined')),
  -- A group of outfalls draining similar activity may be sampled by representative.
  substantially_identical_to  uuid references public.stormwater_outfalls(id) on delete set null,
  is_sampling_point           boolean not null default false,
  status                      text not null default 'active' check (status in ('active','inactive','removed')),
  photo_path                  text check (photo_path is null or length(photo_path) <= 300),
  notes                       text check (notes is null or length(notes) <= 2000),

  created_at                  timestamptz not null default now(),
  created_by                  uuid references public.profiles(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles(id) on delete set null,

  foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade,
  check ((latitude is null) = (longitude is null)),
  check (substantially_identical_to is null or substantially_identical_to <> id),
  unique (tenant_id, facility_id, code)
);

create index if not exists idx_stormwater_outfalls_facility on public.stormwater_outfalls (tenant_id, facility_id, status);

do $$
declare
  t text;
begin
  foreach t in array array['environmental_permits', 'stormwater_outfalls']
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', 'trg_' || t || '_touch', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.log_audit(%L)', 'trg_audit_' || t, t, 'id');

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($pol$
      create policy %I on public.%I
        for select to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (public.active_facility_id() is null or facility_id = public.active_facility_id())
          and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        )
    $pol$, t || '_read', t);

    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format($pol$
      create policy %I on public.%I
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
        )
    $pol$, t || '_admin_write', t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
