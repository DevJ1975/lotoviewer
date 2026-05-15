-- Migration 141: 29 CFR 1910.147(c)(6) annual periodic inspection.
--
-- §147(c)(6)(i) requires an annual inspection of each energy-control
-- procedure to ensure it is still being followed correctly. The
-- standard further requires the inspection to:
--   - be conducted by an authorized employee NOT using the procedure
--   - cover at least one authorized employee operating under each
--     procedure
--   - identify deviations and corrective actions
--   - be certified (signature + date) by the inspector
--
-- Schema:
--
--   loto_periodic_inspections
--     One row per inspection event (one equipment, one inspector).
--     The signature payload + IP / UA mirror the placard sign-off
--     audit pattern from migration 134 so an OSHA auditor sees the
--     same certification semantics across modules.
--
--   loto_equipment.next_periodic_review_due_at
--     Denormalized "next inspection due" timestamp, recomputed by
--     trigger when an inspection row is inserted (last + 365 days).
--     Pre-existing equipment with no inspection row gets a NULL —
--     the admin UI surfaces those as "never inspected".
--
-- RLS: standard tenant-scope pattern (caller's tenant or superadmin).
--
-- Idempotent: re-runs are safe.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. loto_periodic_inspections
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_periodic_inspections (
  id                              uuid        primary key default gen_random_uuid(),
  tenant_id                       uuid        not null references public.tenants(id) on delete cascade,
  equipment_id                    text        not null,
  -- §147(c)(6)(i) requires an authorized employee — we trust the
  -- training-records gate to surface non-current credentials; the FK
  -- here only constrains that the inspector is a real user.
  inspector_user_id               uuid        references public.profiles(id) on delete set null,
  inspector_name                  text        not null
                                    check (length(btrim(inspector_name)) > 0),
  inspected_at                    timestamptz not null default now(),
  -- Snapshot of which authorized employees the inspector observed
  -- using the procedure. Stored as a jsonb array of
  -- { worker_id, full_name } so the audit row survives even if the
  -- worker is later deleted from loto_workers.
  authorized_employees_observed   jsonb       not null default '[]'::jsonb,
  -- Free-text. NULL when no deviations were observed. The B-module
  -- trigger (migration 142) uses presence/absence to decide whether
  -- to create retraining triggers.
  deviations                      text,
  corrective_actions              text,
  -- E-signature payload. signed=false means "in-progress" — the row
  -- can be edited; signed=true freezes it.
  signed                          boolean     not null default false,
  signed_name                     text,
  signature                       text,                    -- data: URI
  signed_at                       timestamptz,
  ip                              text,
  user_agent                      text,
  -- The next inspection's due date. Defaults to inspected_at + 365 days.
  -- The trigger denormalizes this onto loto_equipment for the admin UI.
  next_due_at                     timestamptz not null
                                    default (now() + interval '365 days'),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint chk_signed_payload_consistent
    check (
      (signed = false and signed_at is null)
      or (signed = true and signed_at is not null and length(btrim(coalesce(signed_name, ''))) > 0)
    )
);

create index if not exists idx_loto_periodic_inspections_equipment
  on public.loto_periodic_inspections(tenant_id, equipment_id, inspected_at desc);

create index if not exists idx_loto_periodic_inspections_due
  on public.loto_periodic_inspections(tenant_id, next_due_at)
  where signed = true;

comment on table public.loto_periodic_inspections is
  'Annual procedure inspections per 29 CFR 1910.147(c)(6). One row per inspection event; the most-recent signed row drives loto_equipment.next_periodic_review_due_at.';

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS — tenant-scoped, same posture as the rest of the LOTO module
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_periodic_inspections enable row level security;

drop policy if exists "loto_periodic_inspections_tenant_scope"
  on public.loto_periodic_inspections;
create policy "loto_periodic_inspections_tenant_scope"
  on public.loto_periodic_inspections
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

-- ────────────────────────────────────────────────────────────────────
-- 3. Audit + updated_at triggers
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_loto_periodic_inspections
  on public.loto_periodic_inspections;
create trigger trg_audit_loto_periodic_inspections
  after insert or update or delete on public.loto_periodic_inspections
  for each row execute function public.log_audit('id');

drop trigger if exists trg_loto_periodic_inspections_updated_at
  on public.loto_periodic_inspections;
create trigger trg_loto_periodic_inspections_updated_at
  before update on public.loto_periodic_inspections
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 4. loto_equipment.next_periodic_review_due_at
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_equipment
  add column if not exists next_periodic_review_due_at timestamptz;

comment on column public.loto_equipment.next_periodic_review_due_at is
  'Denormalized next-due timestamp for the §147(c)(6) annual inspection. Recomputed by trigger when a signed inspection lands; NULL means never inspected.';

create index if not exists idx_loto_equipment_periodic_due
  on public.loto_equipment(tenant_id, next_periodic_review_due_at)
  where decommissioned = false;

-- ────────────────────────────────────────────────────────────────────
-- 5. Trigger — keep next_periodic_review_due_at in sync
-- ────────────────────────────────────────────────────────────────────
create or replace function public.sync_loto_equipment_periodic_due()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_max_due timestamptz;
begin
  -- Use the most recent signed inspection's next_due_at as the
  -- equipment's next-due. Unsigned (in-progress) rows do not
  -- count — only certified inspections reset the clock.
  select max(next_due_at)
    into v_max_due
    from public.loto_periodic_inspections
   where tenant_id = coalesce(new.tenant_id, old.tenant_id)
     and equipment_id = coalesce(new.equipment_id, old.equipment_id)
     and signed = true;

  update public.loto_equipment
     set next_periodic_review_due_at = v_max_due
   where tenant_id = coalesce(new.tenant_id, old.tenant_id)
     and equipment_id = coalesce(new.equipment_id, old.equipment_id);

  return null;
end $$;

drop trigger if exists trg_loto_periodic_inspections_sync_due
  on public.loto_periodic_inspections;
create trigger trg_loto_periodic_inspections_sync_due
  after insert or update or delete on public.loto_periodic_inspections
  for each row execute function public.sync_loto_equipment_periodic_due();

notify pgrst, 'reload schema';

commit;
