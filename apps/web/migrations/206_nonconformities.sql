-- Migration 206: source-agnostic nonconformity & CAPA register
-- (ISO 14001 §10.2 / §9.2; benefits ISO 45001 too).
--
-- incident_capas (152) and incident_actions (063/198) can only hang off an
-- incident — incident_id is NOT NULL. So an internal-audit finding, a
-- management-review action, a compliance gap, or an environmental-aspect
-- exceedance has no home for its corrective action. This adds that home:
--
--   1. nonconformities — a finding raised from any source (audit, review,
--      compliance, inspection, aspect, incident, …), classified per ISO
--      (observation / minor / major), optionally pinned to an ISO clause
--      and to an EMS aspect/objective.
--
--   2. nonconformity_actions — the CAPA(s) for a finding, carrying the
--      same ISO §10.2 verification-of-effectiveness loop as incident_capas:
--      completion (the work is done) is distinct from verification (a
--      *different* person later confirms it was effective). The
--      different-verifier rule is enforced at the DB via a trigger, the
--      same way incident_capas / incident_actions enforce it.
--
-- This is additive: incident_capas / incident_actions are untouched and
-- remain the incident-scoped CAPA surface.
--
-- Idempotent.

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1. nonconformities — the finding.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.nonconformities (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants(id) on delete cascade,

  title                text        not null check (length(btrim(title)) > 0),
  description          text,

  -- Where the finding came from — the whole point of this table.
  source_type          text        not null default 'other' check (source_type in (
    'internal_audit','management_review','compliance','inspection',
    'environmental_aspect','incident','customer','other')),
  -- Soft reference to the originating row (an inspection id, obligation
  -- id, …) without a hard cross-module FK.
  source_reference     text,

  -- ISO classification of the finding.
  classification       text        not null default 'minor' check (classification in (
    'observation','minor','major')),
  -- Optional ISO clause the finding is raised against (e.g. "8.1").
  clause_ref           text,

  -- Optional links into the EMS registers (set null if the row is removed).
  related_aspect_id    uuid        references public.environmental_aspects(id) on delete set null,
  related_objective_id uuid        references public.environmental_objectives(id) on delete set null,

  identified_at        date        not null default current_date,
  identified_by        uuid        references auth.users(id) on delete set null,
  owner_user_id        uuid        references auth.users(id) on delete set null,
  status               text        not null default 'open' check (status in (
    'open','in_progress','closed','cancelled')),
  notes                text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id) on delete set null,
  updated_by           uuid        references auth.users(id) on delete set null
);

create index if not exists idx_nonconformities_tenant_status
  on public.nonconformities(tenant_id, status);
create index if not exists idx_nonconformities_source
  on public.nonconformities(tenant_id, source_type);

comment on table public.nonconformities is
  'Source-agnostic nonconformity / finding register (ISO 14001 §10.2, §9.2). The non-incident CAPA home that incident_capas never was.';

alter table public.nonconformities enable row level security;

drop policy if exists "nonconformities_tenant_scope" on public.nonconformities;
create policy "nonconformities_tenant_scope"
  on public.nonconformities
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_nonconformities_touch on public.nonconformities;
create trigger trg_nonconformities_touch
  before update on public.nonconformities
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_nonconformities on public.nonconformities;
create trigger trg_audit_nonconformities
  after insert or update or delete on public.nonconformities
  for each row execute function public.log_audit('id');

-- ════════════════════════════════════════════════════════════════════════
-- 2. nonconformity_actions — the CAPA, with the §10.2 verification loop.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.nonconformity_actions (
  id                    uuid        primary key default gen_random_uuid(),
  tenant_id             uuid        not null references public.tenants(id) on delete cascade,
  nonconformity_id      uuid        not null references public.nonconformities(id) on delete cascade,

  description           text        not null check (length(btrim(description)) > 0),
  action_type           text        not null default 'corrective' check (action_type in (
    'correction','corrective','preventive')),
  assigned_to_user_id   uuid        references auth.users(id) on delete set null,
  due_at                date,

  -- Closure lifecycle: completed_* set together; verified_* set together.
  completed_at          timestamptz,
  completed_by_user_id  uuid        references auth.users(id) on delete set null,
  verified_effective_at timestamptz,
  verified_by_user_id   uuid        references auth.users(id) on delete set null,
  verification_notes    text,

  status                text        not null default 'open' check (status in (
    'open','in_progress','completed','verified','cancelled')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by_user_id    uuid        references auth.users(id) on delete set null,

  check ((completed_at is null) = (completed_by_user_id is null)),
  check ((verified_effective_at is null) = (verified_by_user_id is null)),
  -- Cannot be verified-effective without first being completed.
  check (verified_effective_at is null or completed_at is not null),
  check (
    case status
      when 'completed' then completed_at is not null
      when 'verified'  then completed_at is not null and verified_effective_at is not null
      else true
    end
  )
);

create index if not exists idx_nonconformity_actions_parent
  on public.nonconformity_actions(tenant_id, nonconformity_id);
create index if not exists idx_nonconformity_actions_open
  on public.nonconformity_actions(tenant_id, status)
  where status not in ('verified','cancelled');
create index if not exists idx_nonconformity_actions_assignee
  on public.nonconformity_actions(assigned_to_user_id)
  where assigned_to_user_id is not null and status not in ('verified','cancelled');

comment on table public.nonconformity_actions is
  'Corrective/preventive actions for a nonconformity, with the ISO §10.2 different-verifier verification-of-effectiveness loop.';

alter table public.nonconformity_actions enable row level security;

drop policy if exists "nonconformity_actions_tenant_scope" on public.nonconformity_actions;
create policy "nonconformity_actions_tenant_scope"
  on public.nonconformity_actions
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

-- Separation of duty: the verifier MUST differ from the completer. A check
-- constraint can't express this (both columns are NULL through the
-- lifecycle), so enforce in a trigger — mirrors
-- incident_capas_enforce_different_verifier (152) / incident_actions (198).
create or replace function public.nonconformity_actions_enforce_different_verifier()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  if new.verified_by_user_id is not null
     and new.completed_by_user_id is not null
     and new.verified_by_user_id = new.completed_by_user_id
  then
    raise exception 'verification must be performed by a different user from the completer (separation of duty)';
  end if;
  return new;
end $$;

drop trigger if exists trg_nonconformity_actions_different_verifier
  on public.nonconformity_actions;
create trigger trg_nonconformity_actions_different_verifier
  before insert or update on public.nonconformity_actions
  for each row execute function public.nonconformity_actions_enforce_different_verifier();

drop trigger if exists trg_nonconformity_actions_touch on public.nonconformity_actions;
create trigger trg_nonconformity_actions_touch
  before update on public.nonconformity_actions
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_nonconformity_actions on public.nonconformity_actions;
create trigger trg_audit_nonconformity_actions
  after insert or update or delete on public.nonconformity_actions
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
