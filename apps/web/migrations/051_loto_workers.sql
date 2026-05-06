-- Migration 051: loto_workers table + checkout schema for non-app workers.
--
-- Why: many shop-floor workers don't have email accounts. The current
-- loto_device_checkouts.owner_id is a hard FK to profiles, so the
-- only way to issue a locktag was to invite the worker as an app user
-- — fine for office staff, blocking for production crews.
--
-- This migration:
--   1. Adds public.loto_workers (tenant-scoped roster of non-app workers)
--   2. Makes loto_device_checkouts.owner_id nullable
--   3. Adds loto_device_checkouts.worker_id (FK to loto_workers)
--   4. Adds a XOR check so exactly one of owner_id / worker_id is set
--
-- Training validation continues to key on worker_name (text, lowercase
-- match) — same pattern that's worked for confined-spaces and hot-work
-- since migration 017. A worker's name on the cert lines up with their
-- name in loto_workers, so the existing evaluateLotoTraining helper
-- works without changes.

begin;

-- ────────────────────────────────────────────────────────────────────────
-- 1. loto_workers
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_workers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  full_name     text not null check (length(trim(full_name)) > 0),
  -- Optional employee ID (e.g. "EMP-1234"). Unique per tenant when set
  -- so two HR records for the same person don't collide.
  employee_id   text,
  -- Optional email — useful if the worker later gets app access.
  email         text,
  -- Optional notes (department, shift, etc.). Free-text.
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null
);

-- Tenant-scoped name index for the picker dropdown.
create index if not exists idx_loto_workers_tenant_active
  on public.loto_workers(tenant_id, full_name)
  where active;

-- Unique employee_id per tenant (when populated). Enforces the
-- one-row-per-person invariant without breaking workers who don't
-- have an employee_id assigned.
create unique index if not exists idx_loto_workers_employee_id
  on public.loto_workers(tenant_id, lower(employee_id))
  where employee_id is not null;

comment on table public.loto_workers is
  'Non-app workers eligible to be issued LOTO devices. Per-tenant roster used by the loto_device_checkouts.worker_id FK when the locktag goes to a shop-floor worker without an app login.';

-- ────────────────────────────────────────────────────────────────────────
-- 2. RLS on loto_workers
-- ────────────────────────────────────────────────────────────────────────
alter table public.loto_workers enable row level security;

drop policy if exists "loto_workers_tenant_member_read"  on public.loto_workers;
drop policy if exists "loto_workers_admin_write"         on public.loto_workers;

create policy "loto_workers_tenant_member_read" on public.loto_workers
  for select to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

create policy "loto_workers_admin_write" on public.loto_workers
  for all to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  )
  with check (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

-- ────────────────────────────────────────────────────────────────────────
-- 3. Audit + updated_at triggers (mirror the LOTO module pattern)
-- ────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_loto_workers on public.loto_workers;
create trigger trg_audit_loto_workers
  after insert or update or delete on public.loto_workers
  for each row execute function public.log_audit();

drop trigger if exists trg_loto_workers_updated_at on public.loto_workers;
create trigger trg_loto_workers_updated_at
  before update on public.loto_workers
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────
-- 4. loto_device_checkouts — owner_id nullable, add worker_id, XOR check
-- ────────────────────────────────────────────────────────────────────────
alter table public.loto_device_checkouts
  alter column owner_id drop not null;

alter table public.loto_device_checkouts
  add column if not exists worker_id uuid
    references public.loto_workers(id) on delete restrict;

-- Drop-and-create the constraint so the SQL is unambiguous on re-runs.
alter table public.loto_device_checkouts
  drop constraint if exists chk_loto_checkout_owner_xor;

alter table public.loto_device_checkouts
  add constraint chk_loto_checkout_owner_xor check (
    (owner_id is not null and worker_id is null)
    or
    (owner_id is null and worker_id is not null)
  );

create index if not exists idx_loto_device_checkouts_worker
  on public.loto_device_checkouts(worker_id, checked_out_at desc)
  where worker_id is not null;

notify pgrst, 'reload schema';

commit;
