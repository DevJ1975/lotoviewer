-- Migration 152: Incident CAPAs with verification-of-effectiveness loop.
--
-- ISO 45001 10.2 (nonconformity + corrective action) requires that
-- once an action is completed, the org evaluates whether the action
-- was actually effective — a separate step, by a separate person.
-- The existing incident_actions table (migration 063) ends at
-- "verified": the closer's work was confirmed by another. ISO 10.2
-- asks for the next level: was the underlying nonconformity
-- eliminated? That's a future-tense check, run weeks or months
-- after closure, and it's distinct from the immediate verified-close.
--
-- This migration adds incident_capas — a parallel surface explicitly
-- modeling the verify-effectiveness loop. The naming intentionally
-- diverges from incident_actions ('CAPA' is the ISO term):
--
--   open                — newly created
--   in_progress         — owner is working
--   completed           — owner says done; awaiting verification of effectiveness
--   verified            — a different user has confirmed effectiveness
--   cancelled           — abandoned with a reason
--
-- Hierarchy values use the ISO 45001 8.1.2 short form (eliminate,
-- substitute, engineering, administrative, ppe) — matches the spec
-- and the new HAZARD_CONTROL_HIERARCHY constant in @soteria/core/hazardControls.
--
-- Verification gate: the user marking a CAPA verified MUST be a
-- different user from the one who marked it completed. Enforced at
-- the database via a check trigger so a hand-crafted SQL update
-- can't bypass the rule.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.incident_capas (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  incident_id              uuid        not null references public.incidents(id) on delete cascade,
  description              text        not null
                             check (length(btrim(description)) > 0),
  hierarchy_level          text        not null check (hierarchy_level in (
    'eliminate','substitute','engineering','administrative','ppe')),
  assigned_to_user_id      uuid        references auth.users(id) on delete set null,
  due_at                   timestamptz,
  -- Closure lifecycle. completed_at + completed_by_user_id MUST be
  -- set together; same pattern for verified_*.
  completed_at             timestamptz,
  completed_by_user_id     uuid        references auth.users(id) on delete set null,
  verified_effective_at    timestamptz,
  verified_by_user_id      uuid        references auth.users(id) on delete set null,
  verification_notes       text,
  status                   text        not null default 'open' check (status in (
    'open','in_progress','completed','verified','cancelled')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by_user_id       uuid        references auth.users(id) on delete set null,
  -- Pair invariants — same posture as incident_actions.
  check ((completed_at is null) = (completed_by_user_id is null)),
  check ((verified_effective_at is null) = (verified_by_user_id is null)),
  -- A CAPA cannot be verified-effective without first being completed.
  check (verified_effective_at is null or completed_at is not null),
  -- Status / payload must agree on completion + verification.
  check (
    case status
      when 'completed' then completed_at is not null
      when 'verified'  then completed_at is not null and verified_effective_at is not null
      else true
    end
  )
);

create index if not exists idx_incident_capas_incident
  on public.incident_capas(incident_id, due_at);

create index if not exists idx_incident_capas_tenant_status
  on public.incident_capas(tenant_id, status)
  where status not in ('verified','cancelled');

create index if not exists idx_incident_capas_assigned
  on public.incident_capas(tenant_id, assigned_to_user_id)
  where assigned_to_user_id is not null and status not in ('verified','cancelled');

comment on table public.incident_capas is
  'ISO 45001 10.2 corrective actions with the verification-of-effectiveness loop. Distinct from incident_actions: a CAPA verifies the underlying nonconformity is eliminated, not just that the action item was closed.';

-- ────────────────────────────────────────────────────────────────────
-- 2. Different-verifier rule — enforced at the database boundary
-- ────────────────────────────────────────────────────────────────────
--
-- We enforce in a trigger (not a check constraint) because both
-- columns can be NULL during the lifecycle; a static check would
-- have to handle every transition explicitly and is harder to read.
create or replace function public.incident_capas_enforce_different_verifier()
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
    raise exception 'verification of effectiveness must be performed by a different user from the completer';
  end if;
  return new;
end $$;

drop trigger if exists trg_incident_capas_different_verifier
  on public.incident_capas;
create trigger trg_incident_capas_different_verifier
  before insert or update on public.incident_capas
  for each row execute function public.incident_capas_enforce_different_verifier();

-- ────────────────────────────────────────────────────────────────────
-- 3. RLS — tenant scope, identical to incident_actions
-- ────────────────────────────────────────────────────────────────────
alter table public.incident_capas enable row level security;

drop policy if exists "incident_capas_tenant_scope" on public.incident_capas;
create policy "incident_capas_tenant_scope"
  on public.incident_capas
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- ────────────────────────────────────────────────────────────────────
-- 4. Audit + touch triggers
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_incident_capas on public.incident_capas;
create trigger trg_audit_incident_capas
  after insert or update or delete on public.incident_capas
  for each row execute function public.log_audit('id');

drop trigger if exists trg_incident_capas_updated_at on public.incident_capas;
create trigger trg_incident_capas_updated_at
  before update on public.incident_capas
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
