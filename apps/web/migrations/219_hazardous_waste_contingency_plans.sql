-- Migration 219: LQG contingency plan + Quick Reference Guide records.
--
-- Large quantity generators must maintain a contingency plan and submit a
-- Quick Reference Guide (QRG) to local emergency responders, re-submitting it
-- whenever the plan is amended (40 CFR 262 Subpart M, 262.261-262.262 — moved
-- there from 40 CFR 265 Subpart D by the 2016 Generator Improvements Rule).
--
-- The plan is a facility-level record (one per facility): emergency
-- coordinators, emergency equipment, evacuation plan, estimated max waste on
-- site, the QRG submission tracking, and the last-amended / review dates that
-- drive the "QRG re-submission outstanding" signal.
--
-- One row per facility. RLS mirrors the accumulation-area pattern (migration
-- 142): any tenant member may read; only tenant admin/owner may write.
-- Audit + touch triggers per the project convention.

begin;

create extension if not exists pgcrypto;

create table if not exists public.hazardous_waste_contingency_plans (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  facility_id             uuid not null references public.facilities(id) on delete cascade,

  plan_document_url       text,
  max_waste_quantity      text check (max_waste_quantity is null or length(max_waste_quantity) <= 200),
  evacuation_plan         text check (evacuation_plan is null or length(evacuation_plan) <= 4000),

  -- [{ name, phone, role }]
  emergency_coordinators  jsonb not null default '[]'::jsonb
                            check (jsonb_typeof(emergency_coordinators) = 'array'),
  -- [{ name, location, capabilities }]
  emergency_equipment     jsonb not null default '[]'::jsonb
                            check (jsonb_typeof(emergency_equipment) = 'array'),

  -- Quick Reference Guide submission to local responders.
  qrg_submitted_at        date,
  qrg_submitted_to        text check (qrg_submitted_to is null or length(qrg_submitted_to) <= 300),

  -- Drives the "re-submit the QRG" signal: a QRG submitted before the plan's
  -- last amendment is stale.
  last_amended_at         date,
  review_due_date         date,

  notes                   text check (notes is null or length(notes) <= 4000),

  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id) on delete set null,
  updated_at              timestamptz not null default now(),
  updated_by              uuid references auth.users(id) on delete set null,

  unique (tenant_id, facility_id)
);

create index if not exists idx_hw_contingency_plans_tenant
  on public.hazardous_waste_contingency_plans(tenant_id);

drop trigger if exists trg_hw_contingency_plans_touch on public.hazardous_waste_contingency_plans;
create trigger trg_hw_contingency_plans_touch
  before update on public.hazardous_waste_contingency_plans
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_hw_contingency_plans on public.hazardous_waste_contingency_plans;
create trigger trg_audit_hw_contingency_plans
  after insert or update or delete on public.hazardous_waste_contingency_plans
  for each row execute function public.log_audit('id');

-- ── RLS — member read, admin write (mirrors migration 142) ──────────────────
alter table public.hazardous_waste_contingency_plans enable row level security;

drop policy if exists hw_contingency_plans_tenant_read on public.hazardous_waste_contingency_plans;
create policy hw_contingency_plans_tenant_read on public.hazardous_waste_contingency_plans
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists hw_contingency_plans_admin_write on public.hazardous_waste_contingency_plans;
create policy hw_contingency_plans_admin_write on public.hazardous_waste_contingency_plans
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

grant select, insert, update, delete on public.hazardous_waste_contingency_plans to authenticated;

notify pgrst, 'reload schema';

commit;
