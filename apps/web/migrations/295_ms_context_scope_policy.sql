-- Migration 295: context, interested parties, scope and policy (ISO 14001
-- clauses 4.1, 4.2, 4.3, 5.2).
--
-- First tables of the shared management-system core (ms_ prefix,
-- docs/ems/adr/0001 Q7): each row carries `discipline`, so an ISO 45001
-- module later reuses these tables instead of copying them.
--
--   ms_context_issues      internal / external / climate issues (4.1, Amd 1:2024)
--   ms_interested_parties  who has a stake and what they need (4.2)
--   ms_scope_statements    versioned scope: legal entity, boundary, activities (4.3)
--   ms_policies            versioned policy with its required commitments (5.2)
--
-- Scope and policy are append-only: a change is a new version, so an
-- auditor can see which policy was in force on any date.
--
-- Cross-references are composite foreign keys on (tenant_id, id), so the
-- database itself refuses a link to another tenant's row; a plain id
-- reference would only prove the row exists somewhere.
--
-- Access: members read; tenant admins write (docs/ems/phase-1-plan.md D8).
-- Writes go through /api/environmental/*, using the caller's own client so
-- log_audit() records who made them.
--
-- Idempotent. Rollback: 295_rollback.sql.

begin;

-- Target for same-tenant foreign keys from the registers.
-- Added only if missing: once other tables' foreign keys depend on it, it cannot be dropped and re-added.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_calendar_obligations_tenant_id_id_key') then
    alter table public.compliance_calendar_obligations add constraint compliance_calendar_obligations_tenant_id_id_key unique (tenant_id, id);
  end if;
end $$;

-- ── ms_context_issues ────────────────────────────────────────────────────
create table if not exists public.ms_context_issues (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- null = applies to the whole organization
  facility_id      uuid references public.facilities(id) on delete set null,
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  kind             text not null check (kind in ('internal','external','climate')),
  description      text not null check (length(btrim(description)) > 0),
  relevance        text,
  -- Clause 6.1.1: whether the issue is a risk, an opportunity, or both.
  effect           text check (effect in ('risk','opportunity','both')),
  retired_at       timestamptz,
  retired_reason   text,
  last_reviewed_at timestamptz,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  next_review_due  date not null default (current_date + 365),
  created_by       uuid references public.profiles(id) on delete set null,
  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ms_context_issues_retired_pair check ((retired_at is null) = (retired_reason is null))
);

create index if not exists idx_ms_context_issues_active
  on public.ms_context_issues (tenant_id, discipline, facility_id) where retired_at is null;

-- ── ms_interested_parties ────────────────────────────────────────────────
create table if not exists public.ms_interested_parties (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  facility_id         uuid references public.facilities(id) on delete set null,
  discipline          text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  name                text not null check (length(btrim(name)) > 0),
  needs_expectations  text not null check (length(btrim(needs_expectations)) > 0),
  -- Clause 4.2 c): which needs the organization adopts as compliance obligations.
  becomes_obligation  boolean not null default false,
  obligation_id       uuid,
  retired_at          timestamptz,
  retired_reason      text,
  last_reviewed_at    timestamptz,
  reviewed_by         uuid references public.profiles(id) on delete set null,
  next_review_due     date not null default (current_date + 365),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ms_interested_parties_retired_pair check ((retired_at is null) = (retired_reason is null)),
  constraint ms_interested_parties_obligation_link check (becomes_obligation or obligation_id is null),
  -- Same-tenant link; deleting the obligation clears only obligation_id.
  constraint ms_interested_parties_obligation_fk foreign key (tenant_id, obligation_id)
    references public.compliance_calendar_obligations (tenant_id, id) on delete set null (obligation_id)
);

create index if not exists idx_ms_interested_parties_active
  on public.ms_interested_parties (tenant_id, discipline) where retired_at is null;

-- ── ms_scope_statements (append-only versions) ───────────────────────────
create table if not exists public.ms_scope_statements (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  discipline         text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  version            int  not null check (version >= 1),
  legal_entity       text not null check (length(btrim(legal_entity)) > 0),
  physical_boundary  text not null check (length(btrim(physical_boundary)) > 0),
  activities         text not null check (length(btrim(activities)) > 0),
  products_services  text not null check (length(btrim(products_services)) > 0),
  effective_from     date not null default current_date,
  next_review_due    date not null default (current_date + 365),
  approved_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (tenant_id, discipline, version)
);

-- ── ms_policies (append-only versions) ───────────────────────────────────
create table if not exists public.ms_policies (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  version          int  not null check (version >= 1),
  body             text not null check (length(btrim(body)) > 0),
  -- Keyed by standard: {"ems.protect_environment": true, ...}. ISO 45001
  -- keys (ohs.*) fit beside them without a schema change; which keys are
  -- required is decided by policyIsComplete() in packages/core.
  commitments      jsonb not null check (jsonb_typeof(commitments) = 'object'),
  signatory_name   text not null check (length(btrim(signatory_name)) > 0),
  signatory_title  text,
  signed_at        date not null,
  next_review_due  date not null default (current_date + 365),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, discipline, version)
);

-- ── RLS: member read, admin write (facility-aware where facility_id exists) ─
alter table public.ms_context_issues     enable row level security;
alter table public.ms_interested_parties enable row level security;
alter table public.ms_scope_statements   enable row level security;
alter table public.ms_policies           enable row level security;

drop policy if exists ms_context_issues_member_read on public.ms_context_issues;
create policy ms_context_issues_member_read on public.ms_context_issues
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );
drop policy if exists ms_context_issues_admin_write on public.ms_context_issues;
create policy ms_context_issues_admin_write on public.ms_context_issues
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );

drop policy if exists ms_interested_parties_member_read on public.ms_interested_parties;
create policy ms_interested_parties_member_read on public.ms_interested_parties
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );
drop policy if exists ms_interested_parties_admin_write on public.ms_interested_parties;
create policy ms_interested_parties_admin_write on public.ms_interested_parties
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );

-- Scope and policy: read for members, insert for admins, never update or delete.
drop policy if exists ms_scope_statements_member_read on public.ms_scope_statements;
create policy ms_scope_statements_member_read on public.ms_scope_statements
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_scope_statements_admin_insert on public.ms_scope_statements;
create policy ms_scope_statements_admin_insert on public.ms_scope_statements
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists ms_policies_member_read on public.ms_policies;
create policy ms_policies_member_read on public.ms_policies
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_policies_admin_insert on public.ms_policies;
create policy ms_policies_admin_insert on public.ms_policies
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

revoke update, delete on public.ms_scope_statements from authenticated, anon;
revoke update, delete on public.ms_policies         from authenticated, anon;

-- ── Triggers: touch updated_at, audit every write ────────────────────────
drop trigger if exists trg_ms_context_issues_touch on public.ms_context_issues;
create trigger trg_ms_context_issues_touch
  before update on public.ms_context_issues
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_ms_interested_parties_touch on public.ms_interested_parties;
create trigger trg_ms_interested_parties_touch
  before update on public.ms_interested_parties
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_ms_context_issues on public.ms_context_issues;
create trigger trg_audit_ms_context_issues
  after insert or update or delete on public.ms_context_issues
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_ms_interested_parties on public.ms_interested_parties;
create trigger trg_audit_ms_interested_parties
  after insert or update or delete on public.ms_interested_parties
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_ms_scope_statements on public.ms_scope_statements;
create trigger trg_audit_ms_scope_statements
  after insert or update or delete on public.ms_scope_statements
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_ms_policies on public.ms_policies;
create trigger trg_audit_ms_policies
  after insert or update or delete on public.ms_policies
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
