-- Migration 082: Chemical Management module — Phase A foundation.
--
-- Tables introduced (Phase A subset of docs/chemical-management-system-plan.md):
--   chemical_locations         hierarchical building → room → cabinet
--   chemical_products          one row per manufacturer+product+revision
--   chemical_sds_documents     versioned SDS PDFs (append + supersede)
--
-- Inventory items, drift checks, label print log, and exposure events
-- arrive in a follow-up migration once the catalog UX is shipped.
--
-- Multi-tenancy: tenant_id NOT NULL on every table; RLS uses the
-- standard active_tenant_id() + current_user_tenant_ids() pattern from
-- migration 029. SDS PDFs land in a new `chemical-sds` storage bucket
-- with a tenant-scoped path: chemical-sds/<tenant_uuid>/<product_uuid>/<filename>
--
-- Idempotent — guarded with `if not exists` / `do $$ ... $$` blocks.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. chemical_locations — hierarchical storage locations
-- ──────────────────────────────────────────────────────────────────────────
--
-- Self-referential parent_id. `path` is a denormalized "/" join of
-- ancestor names (Building A / Wash Bay / Cabinet 3) maintained by a
-- trigger so the catalog list can show + search a location string
-- without recursing.

create table if not exists public.chemical_locations (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  parent_id    uuid references public.chemical_locations(id) on delete cascade,
  name         text not null,
  kind         text not null default 'room'
                 check (kind in ('site','building','room','cabinet','shelf','other')),

  -- Denormalized "Building A / Wash Bay / Cabinet 3" — see trigger below.
  path         text,

  notes        text,

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  archived_at  timestamptz
);

create index if not exists idx_chem_locations_tenant
  on public.chemical_locations(tenant_id);
create index if not exists idx_chem_locations_parent
  on public.chemical_locations(parent_id);

create or replace function public.chemical_location_set_path()
  returns trigger
  language plpgsql
as $$
declare
  v_parent_path text;
begin
  if new.parent_id is null then
    new.path := new.name;
  else
    select path into v_parent_path
      from public.chemical_locations
      where id = new.parent_id;
    new.path := coalesce(v_parent_path, '') || ' / ' || new.name;
  end if;
  return new;
end $$;

drop trigger if exists trg_chem_locations_path on public.chemical_locations;
create trigger trg_chem_locations_path
  before insert or update of parent_id, name on public.chemical_locations
  for each row
  execute function public.chemical_location_set_path();

drop trigger if exists trg_chem_locations_touch on public.chemical_locations;
create trigger trg_chem_locations_touch
  before update on public.chemical_locations
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. chemical_products — catalog row
-- ──────────────────────────────────────────────────────────────────────────
--
-- Hazard fields are denormalized from the active SDS so list + search
-- never have to join the SDS document blob. They are populated either
-- manually (Phase A) or by the AI parse pipeline (Phase B). Past SDS
-- revisions are kept in chemical_sds_documents — never overwrite.

create table if not exists public.chemical_products (
  id            uuid not null primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  name          text not null,
  manufacturer  text,
  product_code  text,

  cas_numbers   text[] not null default '{}'::text[],
  synonyms      text[] not null default '{}'::text[],

  physical_state text check (physical_state in
    ('solid','liquid','gas','aerosol','mixture','other')),

  -- GHS classification (see plan §3.1)
  ghs_pictograms          text[] not null default '{}'::text[],
  ghs_signal_word         text check (ghs_signal_word in ('danger','warning')),
  hazard_statements       jsonb,   -- [{code: 'H225', text: 'Highly flammable...'}]
  precautionary_statements jsonb,  -- [{code: 'P210', text: 'Keep away from heat'}]

  -- NFPA 704 / HMIS — 0..4
  nfpa_health        smallint check (nfpa_health between 0 and 4),
  nfpa_flammability  smallint check (nfpa_flammability between 0 and 4),
  nfpa_instability   smallint check (nfpa_instability between 0 and 4),
  nfpa_special       text,

  ppe_required       text[] not null default '{}'::text[],

  flash_point_c      numeric,
  boiling_point_c    numeric,
  vapor_pressure_kpa numeric,

  pel_twa_ppm        numeric,
  stel_ppm           numeric,
  idlh_ppm           numeric,

  first_aid          jsonb,
  firefighting       jsonb,
  spill_cleanup      jsonb,

  storage_class      text,
  incompatibilities  text[] not null default '{}'::text[],

  dot_un_number      text,
  dot_hazard_class   text,
  dot_packing_group  text,

  sds_revision_date  date,
  sds_source_url     text,

  -- Set by the upload flow once the SDS row exists (FK added below).
  active_sds_id      uuid,

  notes              text,

  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id),
  archived_at        timestamptz
);

create index if not exists idx_chem_products_tenant
  on public.chemical_products(tenant_id);
create index if not exists idx_chem_products_name_trgm
  on public.chemical_products using gin (name gin_trgm_ops);
create index if not exists idx_chem_products_manufacturer
  on public.chemical_products(tenant_id, manufacturer);
create index if not exists idx_chem_products_cas
  on public.chemical_products using gin (cas_numbers);
create index if not exists idx_chem_products_pictograms
  on public.chemical_products using gin (ghs_pictograms);

-- pg_trgm extension (idempotent — Supabase has it available).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm;
  end if;
end $$;

drop trigger if exists trg_chem_products_touch on public.chemical_products;
create trigger trg_chem_products_touch
  before update on public.chemical_products
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. chemical_sds_documents — versioned SDS PDFs
-- ──────────────────────────────────────────────────────────────────────────
--
-- Append-only: a new revision inserts a new row and (on approve) flips
-- chemical_products.active_sds_id. Old rows get superseded_by/at set
-- but never deleted — 1910.1020 retention is 30 years past last use.
--
-- file_hash is sha256 of the PDF bytes — used to dedupe re-uploads and
-- to detect "manufacturer revision" vs "same document, re-fetched".

create table if not exists public.chemical_sds_documents (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  product_id      uuid not null references public.chemical_products(id) on delete cascade,

  revision_date   date,
  language        text not null default 'en',

  -- chemical-sds/<tenant_uuid>/<product_uuid>/<filename>.pdf
  storage_path    text not null,
  file_hash       text,           -- sha256 hex
  file_bytes      bigint,
  mime_type       text not null default 'application/pdf',

  -- Raw AI extraction kept for audit. NULL until Phase B ships.
  parsed_payload     jsonb,
  parse_model        text,
  parse_confidence   numeric,
  parse_review_status text not null default 'approved'
    check (parse_review_status in ('pending','approved','rejected')),

  source          text not null default 'upload'
    check (source in ('upload','ai_fetch','manufacturer_portal')),

  superseded_by   uuid references public.chemical_sds_documents(id),
  superseded_at   timestamptz,
  superseded_reason text,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),

  unique (tenant_id, product_id, file_hash)
);

create index if not exists idx_chem_sds_tenant
  on public.chemical_sds_documents(tenant_id);
create index if not exists idx_chem_sds_product
  on public.chemical_sds_documents(product_id, revision_date desc);
create index if not exists idx_chem_sds_review
  on public.chemical_sds_documents(tenant_id, parse_review_status)
  where parse_review_status = 'pending';

-- Now that the table exists, wire products.active_sds_id to it.
-- ON DELETE SET NULL so deleting an SDS row (rare; use supersede) does
-- not cascade-blast the product.
do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = 'chemical_products'
        and constraint_name = 'chemical_products_active_sds_fk'
  ) then
    alter table public.chemical_products
      add constraint chemical_products_active_sds_fk
      foreign key (active_sds_id)
      references public.chemical_sds_documents(id)
      on delete set null;
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket for SDS PDFs
-- ──────────────────────────────────────────────────────────────────────────
--
-- Path layout: chemical-sds/<tenant_uuid>/<product_uuid>/<filename>.pdf
-- Tenant scoping via storage_path_tenant() introduced in migration 033.
-- Reads are limited to authenticated members of the tenant — SDSs are
-- public information by design, but we still gate by tenant so one
-- customer's catalog isn't trivially crawlable.

insert into storage.buckets (id, name, public)
  values ('chemical-sds', 'chemical-sds', false)
  on conflict (id) do nothing;

drop policy if exists "chem_sds_tenant_insert" on storage.objects;
create policy "chem_sds_tenant_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chemical-sds'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists "chem_sds_tenant_update" on storage.objects;
create policy "chem_sds_tenant_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'chemical-sds'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  )
  with check (
    bucket_id = 'chemical-sds'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists "chem_sds_tenant_delete" on storage.objects;
create policy "chem_sds_tenant_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chemical-sds'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists "chem_sds_tenant_read" on storage.objects;
create policy "chem_sds_tenant_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chemical-sds'
    and (
      public.is_superadmin()
      or public.storage_path_tenant(name) in (select public.current_user_tenant_ids())
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Row-Level Security on the new tables
-- ──────────────────────────────────────────────────────────────────────────

alter table public.chemical_locations      enable row level security;
alter table public.chemical_products       enable row level security;
alter table public.chemical_sds_documents  enable row level security;

drop policy if exists chem_locations_tenant on public.chemical_locations;
create policy chem_locations_tenant on public.chemical_locations
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

drop policy if exists chem_products_tenant on public.chemical_products;
create policy chem_products_tenant on public.chemical_products
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

drop policy if exists chem_sds_tenant on public.chemical_sds_documents;
create policy chem_sds_tenant on public.chemical_sds_documents
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
