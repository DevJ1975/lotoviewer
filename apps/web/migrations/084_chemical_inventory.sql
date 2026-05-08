-- Migration 084: chemical inventory containers.
--
-- Phase D of the chemical management module
-- (docs/chemical-management-system-plan.md). Adds chemical_inventory_items
-- — one row per physical container on a tenant's sites, scanned via
-- barcode/QR, located in chemical_locations (already created in 082),
-- and tracked through receive → in-use → empty/disposed.
--
-- A separate sequence per (tenant, year) generates barcode strings of
-- the form "CHEM-{tenant_number}-{year}-{4 digit serial}". Scannable
-- as plain text in the inventory_tag PDF (Phase C). Unique within tenant.
--
-- Idempotent — guarded with `if not exists` / `do $$`.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. chemical_inventory_items — one container per row
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.chemical_inventory_items (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  product_id      uuid not null references public.chemical_products(id) on delete restrict,

  -- Where it physically lives. Nullable so containers in transit /
  -- received-but-not-yet-shelved can be tracked.
  location_id     uuid references public.chemical_locations(id) on delete set null,
  -- Optional department reference (re-uses tenant departments).
  department      text,

  -- Internal barcode — assigned at receipt, printed on the inventory
  -- tag, scanned in the field. UNIQUE per tenant.
  barcode         text not null,

  quantity        numeric not null default 0,
  unit            text not null check (unit in (
    'gal', 'L', 'mL', 'kg', 'g', 'lb', 'oz', 'ea', 'other')),

  container_type  text check (container_type in (
    'drum',         -- 30/55 gal steel/poly
    'tote',         -- IBC 275/330 gal
    'pail',         -- 5 gal
    'bottle',       -- glass/plastic <= 1 gal
    'aerosol',
    'cylinder',     -- compressed gas
    'bag',
    'box',
    'jerrican',
    'tank',         -- fixed bulk
    'other')),

  received_date    date,
  opened_date      date,
  expiration_date  date,
  lot_number       text,
  manufacture_date date,

  -- Phase D states. quarantined = held for inspection / vendor return.
  status          text not null default 'in_stock' check (status in (
    'requested', 'in_stock', 'in_use', 'empty', 'quarantined', 'disposed')),

  assigned_to     uuid references auth.users(id),
  purchase_order  text,
  cost_cents      integer,

  notes           text,

  -- Disposal trail (set when status flips to 'disposed').
  disposed_at      timestamptz,
  disposed_method  text,
  disposed_by      uuid references auth.users(id),
  -- Future RCRA waste-manifest hookup; nullable until Phase G.
  manifest_id      uuid,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),

  unique (tenant_id, barcode)
);

create index if not exists idx_chem_inv_tenant
  on public.chemical_inventory_items(tenant_id);
create index if not exists idx_chem_inv_product
  on public.chemical_inventory_items(product_id);
create index if not exists idx_chem_inv_location
  on public.chemical_inventory_items(location_id)
  where location_id is not null;
create index if not exists idx_chem_inv_status
  on public.chemical_inventory_items(tenant_id, status);
create index if not exists idx_chem_inv_expiring
  on public.chemical_inventory_items(tenant_id, expiration_date)
  where status in ('in_stock', 'in_use')
    and expiration_date is not null;
create index if not exists idx_chem_inv_barcode
  on public.chemical_inventory_items(tenant_id, barcode);

drop trigger if exists trg_chem_inv_touch on public.chemical_inventory_items;
create trigger trg_chem_inv_touch
  before update on public.chemical_inventory_items
  for each row
  execute function public.touch_updated_at();

-- Auto-stamp disposed_at/by when status flips to 'disposed' if not
-- explicitly set. Mirrors the bbs_observations close-out trigger.
create or replace function public.chemical_inv_before_update()
  returns trigger
  language plpgsql
as $$
begin
  if new.status = 'disposed' and old.status <> 'disposed' then
    if new.disposed_at is null then new.disposed_at := now(); end if;
  end if;
  if new.status = 'in_use' and old.status = 'in_stock'
       and new.opened_date is null then
    new.opened_date := current_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_chem_inv_status on public.chemical_inventory_items;
create trigger trg_chem_inv_status
  before update on public.chemical_inventory_items
  for each row
  execute function public.chemical_inv_before_update();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Per-tenant per-year barcode sequence + helper
-- ──────────────────────────────────────────────────────────────────────────
--
-- Format: CHEM-{tenant_number}-{year}-{4-digit serial}. tenant_number
-- already exists on tenants and is human-friendly (e.g. "0042").

create table if not exists public.chemical_barcode_sequences (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  year       int  not null,
  next_value int  not null default 1,
  primary key (tenant_id, year)
);

create or replace function public.chemical_next_barcode(p_tenant uuid)
  returns text
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_year   int;
  v_seq    int;
  v_tnum   text;
begin
  v_year := extract(year from now());

  insert into public.chemical_barcode_sequences (tenant_id, year, next_value)
    values (p_tenant, v_year, 2)
    on conflict (tenant_id, year)
      do update set next_value = public.chemical_barcode_sequences.next_value + 1
    returning next_value - 1 into v_seq;

  select tenant_number into v_tnum from public.tenants where id = p_tenant;
  if v_tnum is null then v_tnum := substr(p_tenant::text, 1, 4); end if;

  return format('CHEM-%s-%s-%s', v_tnum, v_year, lpad(v_seq::text, 4, '0'));
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Reporting view — expiring soon
-- ──────────────────────────────────────────────────────────────────────────

create or replace view public.v_chemical_expiring_soon
  with (security_invoker = true)
  as
  select
    i.id,
    i.tenant_id,
    i.product_id,
    p.name           as product_name,
    p.manufacturer,
    i.location_id,
    l.path           as location_path,
    i.barcode,
    i.quantity,
    i.unit,
    i.expiration_date,
    (i.expiration_date - current_date)::int as days_remaining,
    i.status
  from public.chemical_inventory_items i
  join public.chemical_products p
    on p.id = i.product_id
  left join public.chemical_locations l
    on l.id = i.location_id
  where i.expiration_date is not null
    and i.status in ('in_stock', 'in_use')
    and i.expiration_date <= current_date + interval '60 days';

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────────

alter table public.chemical_inventory_items   enable row level security;
alter table public.chemical_barcode_sequences enable row level security;

drop policy if exists chem_inv_tenant on public.chemical_inventory_items;
create policy chem_inv_tenant on public.chemical_inventory_items
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

-- Sequences are written by a security-definer function only; no direct
-- DML from clients. Lock down with a deny-all policy.
drop policy if exists chem_barcode_seq_deny on public.chemical_barcode_sequences;
create policy chem_barcode_seq_deny on public.chemical_barcode_sequences
  for all to authenticated using (false) with check (false);

notify pgrst, 'reload schema';

commit;
