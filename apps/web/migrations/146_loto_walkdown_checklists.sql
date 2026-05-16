-- Migration 146: §1910.147(c)(6) annual walkdown checklist.
--
-- The periodic inspection (migration 141) records the §(c)(6)
-- certification. This migration adds a structured walkdown
-- checklist that the inspector fills out at the equipment, item
-- by item, with per-item photo evidence. The completed checklist
-- becomes part of the audit binder — when an OSHA inspector asks
-- "show me the walkdown for this equipment," the admin pulls up
-- the latest signed loto_walkdown_checklists row.
--
-- Default checklist items per §147(c)(6):
--   1. Procedure available at point of use
--   2. Energy sources match procedure
--   3. Lock points accessible
--   4. Try-out step verified
--   5. Authorized employees can demonstrate
--   6. Tags legible
--
-- Items are stored as jsonb so the operator can customize / extend
-- without a migration. Each item has an id, label, status, notes,
-- and optional photo_url.
--
-- Idempotent.

begin;

create table if not exists public.loto_walkdown_checklists (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  equipment_id             text        not null,
  walkdown_date            date        not null default current_date,
  -- jsonb array of checklist items. Shape pinned by the TS validator
  -- in lotoWalkdownChecklist.ts.
  items                    jsonb       not null default '[]'::jsonb,
  completed_by_user_id     uuid        references public.profiles(id) on delete set null,
  completed_by_name        text        not null check (length(btrim(completed_by_name)) > 0),
  -- E-signature payload (signed=true freezes the row).
  signed                   boolean     not null default false,
  signed_name              text,
  signature                text,                          -- data: URI
  signed_at                timestamptz,
  -- Free-text general notes (separate from per-item notes).
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint chk_loto_walkdown_signed_consistent
    check (
      (signed = false and signed_at is null)
      or (signed = true and signed_at is not null and length(btrim(coalesce(signed_name, ''))) > 0)
    ),
  constraint chk_loto_walkdown_items_array
    check (jsonb_typeof(items) = 'array')
);

create index if not exists idx_loto_walkdown_equipment
  on public.loto_walkdown_checklists(tenant_id, equipment_id, walkdown_date desc);

comment on table public.loto_walkdown_checklists is
  'Structured walkdown checklists for §1910.147(c)(6). One row per walkdown event. Items are jsonb so operators can extend the default checklist without migrations.';

-- RLS — standard tenant-scoped policy
alter table public.loto_walkdown_checklists enable row level security;

drop policy if exists "loto_walkdown_checklists_tenant_scope"
  on public.loto_walkdown_checklists;
create policy "loto_walkdown_checklists_tenant_scope"
  on public.loto_walkdown_checklists
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_loto_walkdown_checklists
  on public.loto_walkdown_checklists;
create trigger trg_audit_loto_walkdown_checklists
  after insert or update or delete on public.loto_walkdown_checklists
  for each row execute function public.log_audit('id');

drop trigger if exists trg_loto_walkdown_checklists_updated_at
  on public.loto_walkdown_checklists;
create trigger trg_loto_walkdown_checklists_updated_at
  before update on public.loto_walkdown_checklists
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
