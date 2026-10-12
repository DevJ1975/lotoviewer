-- Migration 313: stormwater and discharge outfalls.
--
-- stormwater_outfalls lists a facility's discharge points: the thing outfall
-- checklists are run against. Which permit covers an outfall is a reference into
-- the permit vault (environmental_permits, migration 304), which owns the permit
-- itself; this migration creates no permit table.
--
-- A permit covers an outfall only at the same site, so the reference is the
-- composite (tenant_id, facility_id, permit_id) and the database refuses a permit
-- from another site. That needs a unique key on the vault's (tenant_id,
-- facility_id, id), added below. A permit is retired, never deleted (304), so the
-- reference is never cleared by a delete; set null is only for completeness.
--
-- Access: members read, tenant admins write. Facility scoping as in 211. The
-- (tenant_id, facility_id) pair is a composite foreign key (see 312).
--
-- Depends on 304 (permit vault) and 312. Idempotent. Rollback: 313_rollback.sql.

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.environmental_permits'::regclass
      and conname = 'environmental_permits_tenant_facility_id_key'
  ) then
    alter table public.environmental_permits
      add constraint environmental_permits_tenant_facility_id_key unique (tenant_id, facility_id, id);
  end if;
end $$;

create table if not exists public.stormwater_outfalls (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  facility_id                 uuid not null,
  permit_id                   uuid,

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
  -- With permit_id null the pair is not checked (MATCH SIMPLE), so an uncovered outfall is allowed.
  constraint stormwater_outfalls_permit_fk
    foreign key (tenant_id, facility_id, permit_id)
    references public.environmental_permits (tenant_id, facility_id, id) on delete set null (permit_id),
  check ((latitude is null) = (longitude is null)),
  check (substantially_identical_to is null or substantially_identical_to <> id),
  unique (tenant_id, facility_id, code)
);

create index if not exists idx_stormwater_outfalls_facility on public.stormwater_outfalls (tenant_id, facility_id, status);
create index if not exists idx_stormwater_outfalls_permit on public.stormwater_outfalls (permit_id) where permit_id is not null;

drop trigger if exists trg_stormwater_outfalls_touch on public.stormwater_outfalls;
create trigger trg_stormwater_outfalls_touch before update on public.stormwater_outfalls
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_audit_stormwater_outfalls on public.stormwater_outfalls;
create trigger trg_audit_stormwater_outfalls after insert or update or delete on public.stormwater_outfalls
  for each row execute function public.log_audit('id');

alter table public.stormwater_outfalls enable row level security;

drop policy if exists stormwater_outfalls_read on public.stormwater_outfalls;
create policy stormwater_outfalls_read on public.stormwater_outfalls
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists stormwater_outfalls_admin_write on public.stormwater_outfalls;
create policy stormwater_outfalls_admin_write on public.stormwater_outfalls
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
