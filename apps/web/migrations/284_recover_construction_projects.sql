-- Migration 264: RECOVERY of out-of-band migration 20260806042532
-- ("construction_projects", applied to production 2026-08-06 via MCP).
--
-- This SQL ran against production on 2026-08-06 but was never committed to
-- the repository — no branch or PR carries it, so a rebuild from migrations/
-- would silently lose the entire construction vertical. The body below is
-- byte-identical to production's supabase_migrations.schema_migrations record
-- for version 20260806042532 (verified by md5 06f686f1471903c514927726fd74ebb8
-- during the 2026-08-28 migration reconciliation; see
-- docs/audits/migration-reconciliation-2026-08-28.md).
--
-- Creates the construction schema: construction_projects (+ its shadow
-- facility pairing and PRJ-YYYY-NNNN number sequences), project_areas,
-- project_companies, project_workers, project_calendar, project_presence —
-- 7 tables, 11 functions, the full trigger set, and tenant-scoped RLS with
-- the InitPlan-hoisted (select …) predicate form.
--
-- Depends on: 131 (members), 209 (facilities), 211 (active_facility_id),
-- touch_updated_at / log_audit / is_superadmin / current_user_tenant_ids /
-- active_tenant_id helpers, and the pg_trgm extension (idx_project_areas_label_trgm)
-- — all earlier in the chain. 263 (tenants.industry_profile) is its logical
-- companion and sorts immediately before it.
--
-- Idempotent: `create table/index if not exists`, `create or replace function`,
-- `drop trigger/policy if exists` before create, constraint adds guarded by
-- pg_constraint lookups. Safe to run both where the objects already exist
-- (production, where all 7 tables currently hold 0 rows) and where they do
-- not (a fresh rebuild).

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.facilities'::regclass and conname = 'uq_facilities_tenant_id_pair'
  ) then
    alter table public.facilities add constraint uq_facilities_tenant_id_pair unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.members'::regclass and conname = 'uq_members_tenant_id_pair'
  ) then
    alter table public.members add constraint uq_members_tenant_id_pair unique (tenant_id, id);
  end if;
end;
$$;

create or replace function public.is_iana_timezone(p_zone text)
returns boolean
language sql
immutable
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (select 1 from pg_timezone_names z where z.name = p_zone)
$$;

comment on function public.is_iana_timezone(text) is
  'True when p_zone is a full zone name in pg_timezone_names. Abbreviations such as PST are rejected because they carry a fixed offset and no DST rules. Marked IMMUTABLE so it can back a CHECK constraint; see the header of migration 253.';

create table if not exists public.construction_projects (
  id                    uuid        primary key default gen_random_uuid(),
  tenant_id             uuid        not null references public.tenants(id) on delete cascade,
  facility_id           uuid        not null,
  project_number        text,
  client_project_number text,
  name                  text        not null check (length(btrim(name)) between 1 and 200),
  description           text,
  project_type          text        not null default 'building'
                          check (project_type in
                            ('building','residential','heavy_civil','industrial','utility','other')),
  jurisdiction_id       text        not null default 'federal'
                          check (jurisdiction_id in ('federal','ca','nv')),
  timezone              text        not null check (public.is_iana_timezone(timezone)),
  address_line1         text,
  city                  text,
  state                 text,
  postal_code           text,
  country               text        not null default 'US',
  latitude              numeric(9,6) check (latitude  is null or latitude  between  -90 and  90),
  longitude             numeric(9,6) check (longitude is null or longitude between -180 and 180),
  check ((latitude is null) = (longitude is null)),
  start_date            date,
  scheduled_end_date    date,
  actual_end_date       date,
  check (scheduled_end_date is null or start_date is null or scheduled_end_date >= start_date),
  check (actual_end_date    is null or start_date is null or actual_end_date    >= start_date),
  default_work_days     smallint[]  not null default '{1,2,3,4,5}'
                          check (default_work_days <@ array[1,2,3,4,5,6,7]::smallint[]
                                 and array_length(default_work_days, 1) between 1 and 7),
  status                text        not null default 'planning'
                          check (status in ('planning','active','suspended','closed','archived')),
  settings              jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid        references auth.users(id),
  updated_by            uuid        references auth.users(id),
  constraint construction_projects_facility_fk
    foreign key (tenant_id, facility_id)
    references public.facilities (tenant_id, id)
    on update cascade on delete restrict,
  unique (facility_id),
  unique (tenant_id, id),
  unique (tenant_id, project_number)
);

create unique index if not exists uq_construction_projects_client_number
  on public.construction_projects (tenant_id, lower(btrim(client_project_number)))
  where client_project_number is not null;

create index if not exists idx_construction_projects_tenant_status
  on public.construction_projects (tenant_id, status, name);

comment on column public.construction_projects.timezone is
  'IANA zone for this jobsite. Every daily-boundary artifact resolves through public.project_today(); never current_date.';

create table if not exists public.construction_project_number_sequences (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  year        int  not null,
  next_value  int  not null default 1,
  primary key (tenant_id, year)
);

create or replace function public.set_construction_project_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int;
  v_seq  int;
begin
  if new.project_number is not null then
    return new;
  end if;

  v_year := extract(year from coalesce(new.created_at, now()));

  insert into public.construction_project_number_sequences (tenant_id, year, next_value)
    values (new.tenant_id, v_year, 2)
    on conflict (tenant_id, year)
      do update set next_value = public.construction_project_number_sequences.next_value + 1
    returning next_value - 1 into v_seq;

  new.project_number := format('PRJ-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
  return new;
end;
$$;

drop trigger if exists trg_set_construction_project_number on public.construction_projects;
create trigger trg_set_construction_project_number
  before insert on public.construction_projects
  for each row execute function public.set_construction_project_number();

drop policy if exists construction_project_number_sequences_deny_app
  on public.construction_project_number_sequences;
alter table public.construction_project_number_sequences enable row level security;
create policy construction_project_number_sequences_deny_app
  on public.construction_project_number_sequences
  for all to authenticated
  using (false)
  with check (false);

create or replace function public.create_construction_project(
  p_tenant_id    uuid,
  p_name         text,
  p_timezone     text,
  p_jurisdiction text default 'federal',
  p_project_type text default 'building',
  p_start_date   date default null,
  p_created_by   uuid default null
)
returns public.construction_projects
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_facility public.facilities;
  v_project  public.construction_projects;
begin
  insert into public.facilities (tenant_id, name, is_primary, status)
       values (p_tenant_id, btrim(p_name), false, 'active')
    returning * into v_facility;

  insert into public.construction_projects
         (tenant_id, facility_id, name, timezone, jurisdiction_id,
          project_type, start_date, created_by, updated_by)
       values (p_tenant_id, v_facility.id, btrim(p_name), p_timezone, p_jurisdiction,
               p_project_type, p_start_date, p_created_by, p_created_by)
    returning * into v_project;

  return v_project;
end;
$$;

comment on function public.create_construction_project(uuid, text, text, text, text, date, uuid) is
  'Creates a construction project and its paired shadow facility in one transaction. Two separate writes would eventually orphan a facility in the switcher.';

create or replace function public.sync_construction_project_facility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    update public.facilities
       set status = 'archived'
     where id = old.facility_id and tenant_id = old.tenant_id;
    return old;
  end if;

  update public.facilities
     set name   = new.name,
         code   = new.project_number,
         status = case when new.status = 'archived' then 'archived' else status end
   where id = new.facility_id and tenant_id = new.tenant_id;
  return new;
end;
$$;

drop trigger if exists trg_construction_projects_sync_facility on public.construction_projects;
create trigger trg_construction_projects_sync_facility
  after insert or update of name, status or delete on public.construction_projects
  for each row execute function public.sync_construction_project_facility();

create or replace function public.project_today(p_project_id uuid)
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone p.timezone)::date
    from public.construction_projects p
   where p.id = p_project_id
$$;

create table if not exists public.project_areas (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  project_id    uuid        not null,
  parent_id     uuid        references public.project_areas(id) on delete cascade,
  kind          text        not null default 'area'
                  check (kind in ('zone','building','level','segment','station',
                                  'grid','room','area','other')),
  name          text        not null
                  check (length(btrim(name)) between 1 and 120 and name !~ '/'),
  code          text,
  sort_order    int         not null default 0,
  ancestor_ids  uuid[]      not null default '{}',
  depth         smallint    generated always as
                  (coalesce(array_length(ancestor_ids, 1), 0)::smallint) stored,
  label_path    text        not null,
  status        text        not null default 'active' check (status in ('active','archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid        references auth.users(id),
  updated_by    uuid        references auth.users(id),
  constraint project_areas_project_fk
    foreign key (tenant_id, project_id)
    references public.construction_projects (tenant_id, id) on delete cascade,
  unique (tenant_id, id),
  constraint project_areas_no_cycle
    check (not (id = any(ancestor_ids))),
  constraint project_areas_root_iff_no_ancestors
    check ((parent_id is null) = (ancestor_ids = '{}'::uuid[])),
  constraint project_areas_last_ancestor_is_parent
    check (parent_id is null
           or ancestor_ids[array_length(ancestor_ids, 1)] = parent_id)
);

create index if not exists idx_project_areas_project
  on public.project_areas (tenant_id, project_id, parent_id, sort_order, name);
create index if not exists idx_project_areas_ancestors
  on public.project_areas using gin (ancestor_ids);
create index if not exists idx_project_areas_parent
  on public.project_areas (parent_id) where parent_id is not null;
create index if not exists idx_project_areas_label_trgm
  on public.project_areas using gin (label_path gin_trgm_ops);
create unique index if not exists uq_project_areas_sibling_name
  on public.project_areas (tenant_id, project_id, parent_id, lower(btrim(name)))
  where parent_id is not null;
create unique index if not exists uq_project_areas_root_name
  on public.project_areas (tenant_id, project_id, lower(btrim(name)))
  where parent_id is null;

create or replace function public.project_area_materialize_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_max_depth constant int := 8;
  v_parent    public.project_areas;
begin
  if new.parent_id is null then
    new.ancestor_ids := '{}';
    new.label_path   := btrim(new.name);
    return new;
  end if;

  select * into v_parent
    from public.project_areas
   where id = new.parent_id
     and tenant_id = new.tenant_id
     and project_id = new.project_id;
  if not found then
    raise exception 'parent area % is not in project % of tenant %',
      new.parent_id, new.project_id, new.tenant_id using errcode = '23503';
  end if;

  if new.id = v_parent.id or new.id = any(v_parent.ancestor_ids) then
    raise exception 'cannot move area "%" beneath itself', new.name using errcode = '23514';
  end if;

  new.ancestor_ids := v_parent.ancestor_ids || v_parent.id;
  if array_length(new.ancestor_ids, 1) > c_max_depth then
    raise exception 'project areas nest at most % levels deep', c_max_depth using errcode = '23514';
  end if;
  new.label_path := v_parent.label_path || ' / ' || btrim(new.name);
  return new;
end;
$$;

drop trigger if exists trg_project_areas_materialize on public.project_areas;
create trigger trg_project_areas_materialize
  before insert or update of parent_id, name on public.project_areas
  for each row execute function public.project_area_materialize_path();

create or replace function public.project_area_rewrite_subtree()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  with recursive sub as (
    select a.id,
           new.ancestor_ids || new.id                 as ancestor_ids,
           new.label_path || ' / ' || btrim(a.name)   as label_path
      from public.project_areas a
     where a.parent_id = new.id
    union all
    select c.id,
           s.ancestor_ids || s.id,
           s.label_path || ' / ' || btrim(c.name)
      from public.project_areas c
      join sub s on c.parent_id = s.id
  )
  update public.project_areas a
     set ancestor_ids = sub.ancestor_ids,
         label_path   = sub.label_path
    from sub
   where a.id = sub.id;
  return null;
end;
$$;

drop trigger if exists trg_project_areas_rewrite_subtree on public.project_areas;
create trigger trg_project_areas_rewrite_subtree
  after update of parent_id, name on public.project_areas
  for each row
  when (old.parent_id is distinct from new.parent_id or old.name is distinct from new.name)
  execute function public.project_area_rewrite_subtree();

create table if not exists public.project_companies (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,
  project_id           uuid        not null,
  company_name         text        not null check (length(btrim(company_name)) between 1 and 200),
  legal_name           text,
  license_number       text,
  role                 text        not null default 'subcontractor'
                         check (role in ('owner','prime','subcontractor','supplier',
                                         'consultant','staffing_agency','other')),
  trade                text,
  scope_of_work        text,
  hired_by_company_id  uuid        references public.project_companies(id) on delete restrict,
  ancestor_company_ids uuid[]      not null default '{}',
  tier                 smallint    generated always as
                         (coalesce(array_length(ancestor_company_ids, 1), 0)::smallint) stored,
  contact_name         text,
  contact_email        text,
  contact_phone        text,
  onsite_start_date    date,
  onsite_end_date      date,
  status               text        not null default 'active'
                         check (status in ('active','offboarded','archived')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id),
  updated_by           uuid        references auth.users(id),
  constraint project_companies_project_fk
    foreign key (tenant_id, project_id)
    references public.construction_projects (tenant_id, id) on delete cascade,
  unique (tenant_id, id),
  constraint project_companies_no_cycle
    check (not (id = any(ancestor_company_ids))),
  constraint project_companies_root_iff_no_ancestors
    check ((hired_by_company_id is null) = (ancestor_company_ids = '{}'::uuid[])),
  constraint project_companies_last_ancestor_is_hirer
    check (hired_by_company_id is null
           or ancestor_company_ids[array_length(ancestor_company_ids, 1)] = hired_by_company_id)
);

create unique index if not exists uq_project_companies_name
  on public.project_companies (tenant_id, project_id, lower(btrim(company_name)));
create index if not exists idx_project_companies_project
  on public.project_companies (tenant_id, project_id, status, company_name);
create index if not exists idx_project_companies_ancestors
  on public.project_companies using gin (ancestor_company_ids);
create index if not exists idx_project_companies_hired_by
  on public.project_companies (hired_by_company_id) where hired_by_company_id is not null;

create or replace function public.project_company_materialize_chain()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  c_max_tier constant int := 8;
  v_hirer    public.project_companies;
begin
  if new.hired_by_company_id is null then
    new.ancestor_company_ids := '{}';
    return new;
  end if;

  select * into v_hirer
    from public.project_companies
   where id = new.hired_by_company_id
     and tenant_id = new.tenant_id
     and project_id = new.project_id;
  if not found then
    raise exception 'hiring company % is not on project % of tenant %',
      new.hired_by_company_id, new.project_id, new.tenant_id using errcode = '23503';
  end if;

  if new.id = v_hirer.id or new.id = any(v_hirer.ancestor_company_ids) then
    raise exception 'company "%" cannot be hired by its own subcontractor', new.company_name
      using errcode = '23514';
  end if;

  new.ancestor_company_ids := v_hirer.ancestor_company_ids || v_hirer.id;
  if array_length(new.ancestor_company_ids, 1) > c_max_tier then
    raise exception 'contract chains nest at most % tiers deep', c_max_tier using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_companies_materialize on public.project_companies;
create trigger trg_project_companies_materialize
  before insert or update of hired_by_company_id on public.project_companies
  for each row execute function public.project_company_materialize_chain();

create or replace function public.project_company_rewrite_chain()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  with recursive sub as (
    select c.id, new.ancestor_company_ids || new.id as ancestor_company_ids
      from public.project_companies c
     where c.hired_by_company_id = new.id
    union all
    select d.id, s.ancestor_company_ids || s.id
      from public.project_companies d
      join sub s on d.hired_by_company_id = s.id
  )
  update public.project_companies c
     set ancestor_company_ids = sub.ancestor_company_ids
    from sub
   where c.id = sub.id;
  return null;
end;
$$;

drop trigger if exists trg_project_companies_rewrite_chain on public.project_companies;
create trigger trg_project_companies_rewrite_chain
  after update of hired_by_company_id on public.project_companies
  for each row
  when (old.hired_by_company_id is distinct from new.hired_by_company_id)
  execute function public.project_company_rewrite_chain();

create table if not exists public.project_workers (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  project_id               uuid        not null,
  member_id                uuid        not null,
  project_company_id       uuid        not null,
  role_on_project          text        not null default 'worker'
                             check (role_on_project in
                               ('worker','foreman','superintendent','project_manager',
                                'safety','competent_person','visitor','other')),
  is_supervisory           boolean     not null default false,
  site_badge_number        text,
  orientation_completed_at timestamptz,
  onboarded_on             date,
  offboarded_on            date,
  status                   text        not null default 'active'
                             check (status in ('active','inactive','removed')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid        references auth.users(id),
  updated_by               uuid        references auth.users(id),
  constraint project_workers_project_fk
    foreign key (tenant_id, project_id)
    references public.construction_projects (tenant_id, id) on delete cascade,
  constraint project_workers_member_fk
    foreign key (tenant_id, member_id)
    references public.members (tenant_id, id) on delete cascade,
  constraint project_workers_company_fk
    foreign key (tenant_id, project_company_id)
    references public.project_companies (tenant_id, id) on delete restrict,
  unique (tenant_id, id),
  check (offboarded_on is null or onboarded_on is null or offboarded_on >= onboarded_on)
);

create unique index if not exists uq_project_workers_active
  on public.project_workers (tenant_id, project_id, member_id) where status = 'active';

create index if not exists idx_project_workers_project
  on public.project_workers (tenant_id, project_id, status, project_company_id);
create index if not exists idx_project_workers_member
  on public.project_workers (tenant_id, member_id, status);
create index if not exists idx_project_workers_company
  on public.project_workers (project_company_id) where status = 'active';

create table if not exists public.project_calendar (
  tenant_id          uuid    not null references public.tenants(id) on delete cascade,
  project_id         uuid    not null,
  calendar_date      date    not null,
  is_working_day     boolean not null,
  work_day_ordinal   int,
  non_working_reason text
                       check (non_working_reason is null or non_working_reason in
                         ('weekend','holiday','weather','shutdown','other')),
  high_temp_f        numeric(4,1),
  low_temp_f         numeric(4,1),
  heat_index_f       numeric(4,1),
  weather_source     text check (weather_source is null
                                 or weather_source in ('noaa','manual','import')),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint project_calendar_project_fk
    foreign key (tenant_id, project_id)
    references public.construction_projects (tenant_id, id) on delete cascade,
  primary key (tenant_id, project_id, calendar_date),
  check (is_working_day = (work_day_ordinal is not null)),
  check (is_working_day or non_working_reason is not null)
);

create unique index if not exists uq_project_calendar_ordinal
  on public.project_calendar (tenant_id, project_id, work_day_ordinal)
  where work_day_ordinal is not null;

create or replace function public.recompute_project_calendar_ordinals(
  p_tenant_id  uuid,
  p_project_id uuid
)
returns void
language sql
set search_path = public, pg_temp
as $$
  with numbered as (
    select calendar_date,
           case when is_working_day
                then (count(*) filter (where is_working_day) over (
                        order by calendar_date
                        rows between unbounded preceding and current row))::int
           end as ordinal
      from public.project_calendar
     where tenant_id = p_tenant_id and project_id = p_project_id
  )
  update public.project_calendar c
     set work_day_ordinal = n.ordinal
    from numbered n
   where c.tenant_id = p_tenant_id
     and c.project_id = p_project_id
     and c.calendar_date = n.calendar_date
     and c.work_day_ordinal is distinct from n.ordinal;
$$;

create or replace function public.generate_project_calendar(
  p_tenant_id  uuid,
  p_project_id uuid,
  p_from       date,
  p_to         date,
  p_holidays   date[] default '{}'
)
returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_work_days smallint[];
  v_inserted  int;
begin
  select default_work_days into v_work_days
    from public.construction_projects
   where id = p_project_id and tenant_id = p_tenant_id;
  if v_work_days is null then
    raise exception 'project % not found in tenant %', p_project_id, p_tenant_id
      using errcode = '23503';
  end if;

  insert into public.project_calendar
    (tenant_id, project_id, calendar_date, is_working_day, non_working_reason)
  select p_tenant_id,
         p_project_id,
         d::date,
         working,
         case
           when working then null
           when d::date = any(p_holidays) then 'holiday'
           else 'weekend'
         end
    from generate_series(p_from, p_to, interval '1 day') d
    cross join lateral (
      select extract(isodow from d)::smallint = any(v_work_days)
             and not (d::date = any(p_holidays)) as working
    ) w
  on conflict (tenant_id, project_id, calendar_date) do nothing;

  get diagnostics v_inserted = row_count;
  perform public.recompute_project_calendar_ordinals(p_tenant_id, p_project_id);
  return v_inserted;
end;
$$;

create or replace function public.project_calendar_renumber()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_project_calendar_ordinals(old.tenant_id, old.project_id);
  else
    perform public.recompute_project_calendar_ordinals(new.tenant_id, new.project_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_project_calendar_renumber on public.project_calendar;
create trigger trg_project_calendar_renumber
  after update of is_working_day or delete on public.project_calendar
  for each row execute function public.project_calendar_renumber();

create table if not exists public.project_presence (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null references public.tenants(id) on delete cascade,
  project_id         uuid        not null,
  member_id          uuid        not null,
  presence_date      date        not null,
  first_seen_at      timestamptz not null,
  last_seen_at       timestamptz not null,
  check (last_seen_at >= first_seen_at),
  source             text        not null
                       check (source in ('ptp_signon','permit_signon','toolbox_talk',
                                         'orientation','kiosk','manual')),
  source_record_type text,
  source_record_id   uuid,
  area_id            uuid        references public.project_areas(id) on delete set null,
  project_company_id uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint project_presence_project_fk
    foreign key (tenant_id, project_id)
    references public.construction_projects (tenant_id, id) on delete cascade,
  constraint project_presence_member_fk
    foreign key (tenant_id, member_id)
    references public.members (tenant_id, id) on delete cascade,
  constraint project_presence_company_fk
    foreign key (tenant_id, project_company_id)
    references public.project_companies (tenant_id, id) on delete set null
);

create unique index if not exists uq_project_presence_day
  on public.project_presence (tenant_id, project_id, presence_date, member_id);
create index if not exists idx_project_presence_member
  on public.project_presence (tenant_id, member_id, presence_date desc);

drop trigger if exists trg_construction_projects_touch on public.construction_projects;
create trigger trg_construction_projects_touch
  before update on public.construction_projects
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_project_areas_touch on public.project_areas;
create trigger trg_project_areas_touch
  before update on public.project_areas
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_project_companies_touch on public.project_companies;
create trigger trg_project_companies_touch
  before update on public.project_companies
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_project_workers_touch on public.project_workers;
create trigger trg_project_workers_touch
  before update on public.project_workers
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_project_calendar_touch on public.project_calendar;
create trigger trg_project_calendar_touch
  before update on public.project_calendar
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_project_presence_touch on public.project_presence;
create trigger trg_project_presence_touch
  before update on public.project_presence
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_construction_projects on public.construction_projects;
create trigger trg_audit_construction_projects
  after insert or update or delete on public.construction_projects
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_project_companies on public.project_companies;
create trigger trg_audit_project_companies
  after insert or update or delete on public.project_companies
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_project_workers on public.project_workers;
create trigger trg_audit_project_workers
  after insert or update or delete on public.project_workers
  for each row execute function public.log_audit('id');

create or replace function public.current_user_supervised_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct c.id), '{}')
    from public.project_workers pw
    join public.members m on m.id = pw.member_id
    join public.project_companies c
      on c.tenant_id = pw.tenant_id
     and (c.id = pw.project_company_id
          or pw.project_company_id = any(c.ancestor_company_ids))
   where m.profile_id = auth.uid()
     and pw.status = 'active'
     and pw.is_supervisory
$$;

revoke all on function public.current_user_supervised_company_ids() from public, anon;
grant execute on function public.current_user_supervised_company_ids() to authenticated;

alter table public.construction_projects enable row level security;
alter table public.project_areas         enable row level security;
alter table public.project_companies     enable row level security;
alter table public.project_workers       enable row level security;
alter table public.project_calendar      enable row level security;
alter table public.project_presence      enable row level security;

drop policy if exists construction_projects_tenant_scope on public.construction_projects;
create policy construction_projects_tenant_scope on public.construction_projects
  for all to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
    and ((select public.active_facility_id()) is null
         or facility_id = (select public.active_facility_id()))
  )
  with check (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
    and ((select public.active_facility_id()) is null
         or facility_id = (select public.active_facility_id()))
  );

drop policy if exists project_areas_tenant_scope on public.project_areas;
create policy project_areas_tenant_scope on public.project_areas
  for all to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  )
  with check (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  );

drop policy if exists project_companies_tenant_scope on public.project_companies;
create policy project_companies_tenant_scope on public.project_companies
  for all to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  )
  with check (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  );

drop policy if exists project_workers_tenant_scope on public.project_workers;
create policy project_workers_tenant_scope on public.project_workers
  for all to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  )
  with check (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  );

drop policy if exists project_calendar_tenant_scope on public.project_calendar;
create policy project_calendar_tenant_scope on public.project_calendar
  for all to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  )
  with check (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  );

drop policy if exists project_presence_tenant_scope on public.project_presence;
create policy project_presence_tenant_scope on public.project_presence
  for all to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  )
  with check (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (tenant_id in (select public.current_user_tenant_ids()) or (select public.is_superadmin()))
  );

comment on table public.construction_projects is
  'One construction job. Paired 1:1 with a facilities row that carries the scope/RLS axis; this row carries the construction record (timezone, jurisdiction, dates, coordinates, project number).';
comment on table public.project_companies is
  'Every employer on a job, with the contractual chain (hired_by_company_id + ancestor_company_ids). Answers OSHA multi-employer control questions without a recursive CTE.';
comment on table public.project_presence is
  'Evidence a person was on this project on this day, derived from signed safety artifacts. NOT a timekeeping record: no hours, no punches, no pay code, ever.';

notify pgrst, 'reload schema';

commit;
