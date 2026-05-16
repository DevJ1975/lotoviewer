-- Migration 151: Tenant retention policy + legal hold register.
--
-- Regulatory backbone:
--   29 CFR 1904.33   — 5-year retention for OSHA 300 logs.
--   29 CFR 1910.1020 — 30-year retention for employee exposure records.
--   29 CFR 1910.147(c)(6)(ii) — annual periodic-inspection certifications
--                    must be retained until the next inspection is
--                    certified (de facto 1 year + a buffer).
--   Litigation-hold doctrine (Zubulake, Sedona) — a legal hold ALWAYS
--                    trumps a retention schedule. Once a hold is placed,
--                    the records under its scope must not be deleted,
--                    archived, or modified until the hold is released.
--
-- Two tables:
--   tenant_retention_policies — one row per tenant, configurable per
--     record type. Defaults seeded for active tenants.
--   legal_holds              — register of every hold the org has
--     placed, scoped to a record type + optional record id. Open holds
--     have released_at = NULL.
--
-- The cron that actually deletes data is a future deliverable — this
-- module classifies + surfaces. No automated deletion happens yet.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. tenant_retention_policies — one row per tenant, mutable
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_retention_policies (
  tenant_id                    uuid        primary key references public.tenants(id) on delete cascade,
  -- OSHA 300 / 300A — 29 CFR 1904.33 mandates 5 years.
  incident_retention_days      int         not null default 1825
                                 check (incident_retention_days >= 0),
  -- LOTO + hot-work + confined-space permits — internal best practice
  -- of 3 years (no specific OSHA mandate; ISO 45001 9.1 implies "long
  -- enough to demonstrate trends").
  permit_retention_days        int         not null default 1095
                                 check (permit_retention_days >= 0),
  -- Training records — §1910.147(c)(7)(iv) requires retention so long
  -- as the employee is authorized; 3 years is a conservative floor
  -- the tenant can tighten or extend per their HR program.
  training_retention_days      int         not null default 1095
                                 check (training_retention_days >= 0),
  -- LOTO procedure/placard binders — internal default 7 years to align
  -- with general-industry recordkeeping practice. Tracked in YEARS
  -- because the audit cycles think in years not days; storing both
  -- formats is asking for drift, so we standardize on years here and
  -- multiply when comparing against ages-in-days at the app layer.
  loto_artifact_retention_years int        not null default 7
                                 check (loto_artifact_retention_years >= 0),
  updated_at                   timestamptz not null default now(),
  updated_by                   uuid        references auth.users(id) on delete set null
);

comment on table public.tenant_retention_policies is
  'Per-tenant retention windows by record type. Drives the classification helper in packages/core/src/retentionPolicy.ts. Actual deletion happens via a future cron — this table only declares intent.';

-- Seed every existing tenant with defaults. The constants chosen
-- match the column defaults above; a tenant that wants to tighten
-- retention does so in /admin/retention.
insert into public.tenant_retention_policies
  (tenant_id, incident_retention_days, permit_retention_days, training_retention_days, loto_artifact_retention_years)
select t.id, 1825, 1095, 1095, 7
  from public.tenants t
  where t.disabled_at is null
  on conflict (tenant_id) do nothing;

-- ────────────────────────────────────────────────────────────────────
-- 2. legal_holds — register of every hold placed by the org
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.legal_holds (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  -- Which class of records this hold covers. 'all' applies the hold
  -- to every record type listed — useful for major-litigation events
  -- (an SEC subpoena, a serious-injury lawsuit) where the prudent
  -- posture is "freeze everything".
  scope                    text        not null check (scope in (
    'incident','permit','equipment','chemical','all')),
  -- Optional narrowing — when set, the hold targets one specific
  -- record by id (text because incident IDs are uuid but equipment_id
  -- is text). NULL = the entire class.
  scope_id                 text,
  reason                   text        not null check (length(btrim(reason)) > 0),
  placed_by_user_id        uuid        not null references auth.users(id),
  placed_at                timestamptz not null default now(),
  released_at              timestamptz,
  released_by_user_id      uuid        references auth.users(id),
  -- Closure invariants — released_by + released_at always come as a pair.
  check ((released_at is null) = (released_by_user_id is null))
);

create index if not exists idx_legal_holds_tenant_open
  on public.legal_holds(tenant_id, scope)
  where released_at is null;

create index if not exists idx_legal_holds_scope_id
  on public.legal_holds(tenant_id, scope_id)
  where released_at is null and scope_id is not null;

comment on table public.legal_holds is
  'Litigation / regulatory holds. An open hold (released_at NULL) prevents purge of any record matching its scope, regardless of the tenant retention policy.';

-- ────────────────────────────────────────────────────────────────────
-- 3. legal_hold_id columns on the records that can be held
-- ────────────────────────────────────────────────────────────────────
--
-- These columns are informational — the legal_holds table is the
-- system of record. The FK column gives the UI a fast "is this row
-- currently held?" check without a join + subquery, and lets the
-- retention cron skip held rows with a simple WHERE legal_hold_id IS
-- NULL clause.

alter table public.incidents
  add column if not exists legal_hold_id uuid references public.legal_holds(id) on delete set null;
create index if not exists idx_incidents_legal_hold
  on public.incidents(legal_hold_id) where legal_hold_id is not null;

alter table public.loto_confined_space_permits
  add column if not exists legal_hold_id uuid references public.legal_holds(id) on delete set null;
create index if not exists idx_cs_permits_legal_hold
  on public.loto_confined_space_permits(legal_hold_id) where legal_hold_id is not null;

alter table public.loto_hot_work_permits
  add column if not exists legal_hold_id uuid references public.legal_holds(id) on delete set null;
create index if not exists idx_hot_work_permits_legal_hold
  on public.loto_hot_work_permits(legal_hold_id) where legal_hold_id is not null;

alter table public.loto_equipment
  add column if not exists legal_hold_id uuid references public.legal_holds(id) on delete set null;
create index if not exists idx_loto_equipment_legal_hold
  on public.loto_equipment(legal_hold_id) where legal_hold_id is not null;

-- ────────────────────────────────────────────────────────────────────
-- 4. RLS — tenant-scoped on both new tables
-- ────────────────────────────────────────────────────────────────────
alter table public.tenant_retention_policies enable row level security;
alter table public.legal_holds                enable row level security;

drop policy if exists "tenant_retention_policies_tenant_scope"
  on public.tenant_retention_policies;
create policy "tenant_retention_policies_tenant_scope"
  on public.tenant_retention_policies
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "legal_holds_tenant_scope" on public.legal_holds;
create policy "legal_holds_tenant_scope"
  on public.legal_holds
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
-- 5. Audit + touch triggers
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_tenant_retention_policies
  on public.tenant_retention_policies;
create trigger trg_audit_tenant_retention_policies
  after insert or update or delete on public.tenant_retention_policies
  for each row execute function public.log_audit('tenant_id');

drop trigger if exists trg_tenant_retention_policies_updated_at
  on public.tenant_retention_policies;
create trigger trg_tenant_retention_policies_updated_at
  before update on public.tenant_retention_policies
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_legal_holds on public.legal_holds;
create trigger trg_audit_legal_holds
  after insert or update or delete on public.legal_holds
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
