-- Migration 163: Contractor prequalification.
--
-- Before a contractor sets foot on site, the host expects to see:
--
--   1. A documented safety management system
--   2. EMR (Experience Modification Rate, a workers'-comp metric)
--   3. DART (Days Away, Restricted, Transferred — OSHA recordable rate)
--   4. TRIR (Total Recordable Incident Rate)
--   5. ISO 45001 / OSHA VPP certifications, if any
--   6. Drug & alcohol program
--   7. Insurance limits — general liability, workers' comp
--   8. Past-performance references
--
-- These are the eight items the major contractor-management
-- platforms (ISNetworld, Avetta, Veriforce) gate on. We do not try
-- to mimic those platforms' nine-tab forms; we capture an answer for
-- each item and store it as free text plus a couple of structured
-- booleans where the binary nature is well-defined.
--
-- Workflow:
--   1. Admin opens the contractor's prequal page and presses Invite.
--   2. A tokenized link is emailed (the same review_link token shape
--      from migration 035) to the contractor's contact email.
--   3. Contractor fills the form via /contractor-prequal/[token] —
--      no login required.
--   4. Admin reviews, approves with an expiry (default 1 year), or
--      rejects.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. vendor_prequalifications
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.vendor_prequalifications (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  contractor_company_id    uuid        not null references public.loto_contractor_companies(id) on delete cascade,
  status                   text        not null default 'invited'
                             check (status in ('invited', 'in_progress', 'approved', 'rejected', 'expired')),
  -- Eight prequalification items.
  q1_safety_management     text,
  q2_emr                   text,
  q3_dart                  text,
  q4_trir                  text,
  q5_iso_certs             text,
  q6_drug_alcohol_program  boolean     not null default false,
  q7_insurance_limits      text,
  q8_references            text,
  submitted_at             timestamptz,
  reviewed_at              timestamptz,
  reviewed_by_user_id      uuid        references auth.users(id) on delete set null,
  approval_expires_at      date,
  -- Tokenized public-portal access. Same shape as loto_review_links
  -- (migration 035) — 32 hex chars, populated by a BEFORE INSERT
  -- trigger on first insert.
  portal_token             text,
  -- Free-form notes from the reviewing admin (e.g. "approved
  -- contingent on PPE refresh by 2026-09-01"). Visible to the
  -- contractor on the portal.
  review_notes             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- Reviewer pair: status approved/rejected requires reviewed_at + by.
  check (
    case status
      when 'approved' then reviewed_at is not null and reviewed_by_user_id is not null
      when 'rejected' then reviewed_at is not null and reviewed_by_user_id is not null
      else true
    end
  )
);

-- Token format guard. Mirrors loto_review_links_token_format.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vendor_prequalifications_token_format'
  ) then
    alter table public.vendor_prequalifications
      add constraint vendor_prequalifications_token_format
      check (portal_token is null or portal_token ~ '^[0-9a-f]{32}$');
  end if;
end $$;

create unique index if not exists idx_vendor_prequal_token
  on public.vendor_prequalifications(portal_token)
  where portal_token is not null;

create index if not exists idx_vendor_prequal_contractor
  on public.vendor_prequalifications(tenant_id, contractor_company_id, created_at desc);

create index if not exists idx_vendor_prequal_status_expiring
  on public.vendor_prequalifications(tenant_id, approval_expires_at)
  where status = 'approved' and approval_expires_at is not null;

comment on table public.vendor_prequalifications is
  'Contractor prequalification answers + approval lifecycle. One row per (contractor, prequal cycle). portal_token gates the public no-login contractor form.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Token generator — reuses next_signon_token from migration 024
-- ────────────────────────────────────────────────────────────────────
create or replace function public.set_vendor_prequal_token()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  if new.portal_token is null then
    new.portal_token := public.next_signon_token();
  end if;
  return new;
end $$;

drop trigger if exists trg_vendor_prequal_set_token on public.vendor_prequalifications;
create trigger trg_vendor_prequal_set_token
  before insert on public.vendor_prequalifications
  for each row execute function public.set_vendor_prequal_token();

-- ────────────────────────────────────────────────────────────────────
-- 3. RLS — tenant-scoped on the admin path; the public portal goes
--    through the service-role API at /api/contractor-prequal/[token].
-- ────────────────────────────────────────────────────────────────────
alter table public.vendor_prequalifications enable row level security;

drop policy if exists "vendor_prequalifications_tenant_scope"
  on public.vendor_prequalifications;
create policy "vendor_prequalifications_tenant_scope"
  on public.vendor_prequalifications
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
-- 4. Audit + touch triggers
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_vendor_prequalifications
  on public.vendor_prequalifications;
create trigger trg_audit_vendor_prequalifications
  after insert or update or delete on public.vendor_prequalifications
  for each row execute function public.log_audit('id');

drop trigger if exists trg_vendor_prequalifications_updated_at
  on public.vendor_prequalifications;
create trigger trg_vendor_prequalifications_updated_at
  before update on public.vendor_prequalifications
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
