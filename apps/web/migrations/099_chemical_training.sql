-- Migration 092: HazCom training cross-link (Phase G slice 7).
--
-- Two changes:
--
--   1. Extend loto_training_records.role enum with 'hazcom' (the
--      OSHA 29 CFR 1910.1200 generic baseline) and 'chemical_specific'
--      (per-chemical training that some products demand on top of
--      HazCom — anhydrous ammonia operators, peracetic acid handlers,
--      etc.). Pattern matches migration 050 (drop + re-add CHECK).
--
--   2. chemical_training_requirements join table linking a chemical
--      to the training role(s) a worker must hold to handle it.
--      Tenants populate this manually; defaults are not seeded so we
--      don't make policy assumptions on their behalf.
--
-- Idempotent.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Extend the role enum.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.loto_training_records
  drop constraint if exists loto_training_records_role_check;

alter table public.loto_training_records
  add constraint loto_training_records_role_check
    check (role in (
      'entrant',
      'attendant',
      'entry_supervisor',
      'rescuer',
      'hot_work_operator',
      'fire_watcher',
      'authorized_employee',
      -- Added in this migration.
      'hazcom',
      'chemical_specific',
      'other'));

-- ──────────────────────────────────────────────────────────────────────────
-- 2. chemical_training_requirements
-- ──────────────────────────────────────────────────────────────────────────
--
-- One row per (product, role) pair the tenant deems required.
-- product_id alone covers "every container of this chemical needs
-- the listed training". We don't model task-level requirements at
-- this slice — JHA-step PPE coverage from migration 089 already
-- captures task-driven gaps; training is product-driven here.

create table if not exists public.chemical_training_requirements (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  product_id   uuid not null references public.chemical_products(id) on delete cascade,

  -- Free-form text matching loto_training_records.role values. We
  -- don't FK to an enum table because the enum is a CHECK constraint
  -- in 017/021/050 — easier to keep one source of truth there and let
  -- the API validate values on insert.
  role         text not null,

  notes        text,

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),

  unique (tenant_id, product_id, role)
);

create index if not exists idx_chem_training_req_tenant
  on public.chemical_training_requirements(tenant_id);
create index if not exists idx_chem_training_req_product
  on public.chemical_training_requirements(product_id);

alter table public.chemical_training_requirements enable row level security;

drop policy if exists chem_training_req_tenant on public.chemical_training_requirements;
create policy chem_training_req_tenant on public.chemical_training_requirements
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
