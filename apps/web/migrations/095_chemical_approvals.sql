-- Migration 088: chemical inventory approval workflow (Phase G slice 2).
--
-- Adds an explicit approve/reject path on top of the existing
-- chemical_inventory_items.status enum:
--
--   'requested'  → worker filed a request; awaits admin review
--   'in_stock'   → already in the enum; approval flips here
--   'rejected'   → NEW; admin declined; rejection_reason captures why
--
-- Workflow stamps approved_at/approved_by on transitions OUT of
-- 'requested' so the audit trail is unambiguous.
--
-- Idempotent.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Extend the status enum to include 'rejected'.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Postgres CHECK constraints are not directly mutable, so drop +
-- re-add. Existing rows are unaffected (none should be 'rejected'
-- yet).

alter table public.chemical_inventory_items
  drop constraint if exists chemical_inventory_items_status_check;

alter table public.chemical_inventory_items
  add constraint chemical_inventory_items_status_check
  check (status in (
    'requested', 'in_stock', 'in_use', 'empty',
    'quarantined', 'disposed', 'rejected'));

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Approval-trail columns.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.chemical_inventory_items
  add column if not exists approved_at        timestamptz,
  add column if not exists approved_by        uuid references auth.users(id),
  add column if not exists rejection_reason   text,
  add column if not exists requested_by       uuid references auth.users(id),
  add column if not exists requested_at       timestamptz;

-- A partial index over the approval queue keeps the dashboard
-- query (`status='requested'`) fast even on tenants with thousands
-- of historical containers.
create index if not exists idx_chem_inv_pending_approval
  on public.chemical_inventory_items(tenant_id, requested_at desc)
  where status = 'requested';

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Trigger: stamp requested_at/by on insert when status='requested',
-- and stamp approved_at/by when status flips OUT of 'requested' to a
-- non-rejected value.
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.chemical_inv_approval_stamps()
  returns trigger
  language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if new.status = 'requested' then
      if new.requested_at is null then new.requested_at := now(); end if;
      if new.requested_by is null then new.requested_by := new.created_by; end if;
    end if;
    return new;
  end if;

  -- UPDATE path
  if old.status = 'requested' and new.status <> 'requested' then
    if new.status = 'rejected' then
      -- approved_at/by stay null on rejection; rejection is captured
      -- in rejection_reason + updated_by + updated_at via the existing
      -- touch_updated_at trigger.
      null;
    else
      if new.approved_at is null then new.approved_at := now(); end if;
      if new.approved_by is null then new.approved_by := new.updated_by; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_chem_inv_approval_stamps on public.chemical_inventory_items;
create trigger trg_chem_inv_approval_stamps
  before insert or update of status on public.chemical_inventory_items
  for each row
  execute function public.chemical_inv_approval_stamps();

notify pgrst, 'reload schema';

commit;
