-- Migration 144: §147(f)(2) host-employer / contractor LOTO coordination.
--
-- §147(f)(2) requires that when an outside contractor is involved in
-- maintenance, the on-site (host) employer and the contractor inform
-- each other of their respective energy-control procedures and ensure
-- the host's authorized employees understand the contractor's
-- restrictions. The host's procedures must be acknowledged by the
-- contractor before the work begins.
--
-- Today the app tracks workers (loto_workers) and personal-lock
-- checkouts but has no contractor-company entity. This migration adds:
--
--   loto_contractor_companies: per-company record with insurance
--     expiry and host-acknowledgement timestamp
--   loto_workers.contractor_company_id: optional FK linking a worker
--     to a contractor company (a non-app worker can be either an
--     employee or a contractor, never both — the constraint is the
--     usual app-layer convention since loto_workers doesn't have a
--     boolean discriminator)
--
-- Idempotent: re-runs are safe.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. loto_contractor_companies
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_contractor_companies (
  id                              uuid        primary key default gen_random_uuid(),
  tenant_id                       uuid        not null references public.tenants(id) on delete cascade,
  name                            text        not null check (length(btrim(name)) > 0),
  contact_email                   text
                                    check (contact_email is null or contact_email ~ '^[^@]+@[^@]+\.[^@]+$'),
  contact_phone                   text,
  -- Insurance expiry. §(f)(2) doesn't require it directly, but every
  -- host MSDS / safety policy does. NULL = on file but no date entered.
  insurance_expires_at            date,
  -- When the contractor acknowledged the host's LOTO procedures.
  -- Pair with the user who recorded the acknowledgement.
  host_procedures_acknowledged_at timestamptz,
  host_acknowledged_by_user_id    uuid        references public.profiles(id) on delete set null,
  notes                           text,
  active                          boolean     not null default true,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- One company name per tenant when active. Allows reusing a name
-- after a contractor is disabled (set active = false then re-add).
create unique index if not exists idx_loto_contractor_company_name_active
  on public.loto_contractor_companies(tenant_id, lower(name))
  where active;

create index if not exists idx_loto_contractor_company_insurance_exp
  on public.loto_contractor_companies(tenant_id, insurance_expires_at)
  where active and insurance_expires_at is not null;

comment on table public.loto_contractor_companies is
  'Outside contractor companies subject to §1910.147(f)(2). Host-procedure acknowledgement is captured per contractor; insurance expiry drives the renewal digest.';

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_contractor_companies enable row level security;

drop policy if exists "loto_contractor_companies_tenant_scope"
  on public.loto_contractor_companies;
create policy "loto_contractor_companies_tenant_scope"
  on public.loto_contractor_companies
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_loto_contractor_companies
  on public.loto_contractor_companies;
create trigger trg_audit_loto_contractor_companies
  after insert or update or delete on public.loto_contractor_companies
  for each row execute function public.log_audit('id');

drop trigger if exists trg_loto_contractor_companies_updated_at
  on public.loto_contractor_companies;
create trigger trg_loto_contractor_companies_updated_at
  before update on public.loto_contractor_companies
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 3. loto_workers.contractor_company_id
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_workers
  add column if not exists contractor_company_id uuid
    references public.loto_contractor_companies(id) on delete set null;

create index if not exists idx_loto_workers_contractor
  on public.loto_workers(tenant_id, contractor_company_id)
  where contractor_company_id is not null;

comment on column public.loto_workers.contractor_company_id is
  'Nullable link to a contractor company. NULL = direct employee. The placard sign-on flow surfaces "contractor lock" badging when this is set.';

notify pgrst, 'reload schema';

commit;
