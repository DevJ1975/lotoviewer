-- Migration 038: Risk Assessment immutable audit log.
--
-- Every change to a risk record (score change, control change, status
-- change, owner change) is logged with actor, timestamp, before/after
-- row JSON. The PDD §13.2 + the prompt's quality bar both call for
-- append-only enforcement at the DB level — defense against a
-- compromised auth user OR a future code path that forgets the
-- immutability constraint.
--
-- Three layers of belt-and-suspenders:
--   1. Role grants restrict mutation: REVOKE UPDATE, DELETE on the
--      table from the `authenticated` role. Service-role retains
--      INSERT (the trigger uses SECURITY DEFINER to insert).
--   2. A BEFORE UPDATE OR DELETE trigger raises an exception on any
--      attempted mutation, so even if someone forgot the revoke or
--      a future role gets the wrong grants, the trigger stops them.
--   3. The audit_trigger fires on AFTER INSERT / UPDATE / DELETE on
--      `risks` and inserts the relevant before/after snapshots.
--
-- The same logic could be extended to risk_controls / risk_reviews
-- / risk_attachments later — for Phase 1, the `risks` row is the
-- source of truth for compliance audit; the linked tables are
-- snapshotted via the row's `updated_at` cascade and join-time
-- queries.
--
-- Idempotent — guards on table create + role grant + trigger.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. risk_audit_log — append-only event store
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.risk_audit_log (
  id           bigserial primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  risk_id      uuid not null,
  -- INSERT / UPDATE / DELETE — narrows what before_row + after_row
  -- mean. INSERT has after_row only; DELETE has before_row only;
  -- UPDATE has both.
  event_type   text not null check (event_type in ('insert','update','delete')),
  -- Field-level diff is computed at read time from before/after.
  -- Storing it pre-computed would inflate the log + make queries
  -- against historical risk shapes brittle.
  before_row   jsonb,
  after_row    jsonb,
  actor_id     uuid,                                  -- auth.uid() at the time
  actor_email  text,                                  -- denormalized for display
  -- Free-form context (e.g. 'wizard-submit', 'cron-rescore',
  -- 'service-role-import') — set by the caller via
  -- set_config('soteria.audit_context', '...', true) before mutating
  -- the risk row, otherwise NULL.
  context      text,
  occurred_at  timestamptz not null default now()
);

create index if not exists idx_risk_audit_log_risk
  on public.risk_audit_log(risk_id, occurred_at desc);
create index if not exists idx_risk_audit_log_tenant
  on public.risk_audit_log(tenant_id, occurred_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Append-only enforcement
-- ──────────────────────────────────────────────────────────────────────────

-- Layer 1 — role grants. Authenticated cannot UPDATE or DELETE; only
-- SELECT + INSERT. (The audit trigger runs as SECURITY DEFINER so it
-- can insert regardless of the caller's role.)
revoke update, delete on public.risk_audit_log from public;
revoke update, delete on public.risk_audit_log from authenticated;
revoke update, delete on public.risk_audit_log from anon;

-- Layer 2 — BEFORE UPDATE OR DELETE trigger. Even if the role grants
-- get changed later, this trigger fires regardless of caller role
-- (including service-role) and raises an exception.
create or replace function public.risk_audit_log_immutable()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'risk_audit_log is append-only (tg_op=% on row id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = 'integrity_constraint_violation';
end $$;

drop trigger if exists trg_risk_audit_log_immutable on public.risk_audit_log;
create trigger trg_risk_audit_log_immutable
  before update or delete on public.risk_audit_log
  for each row
  execute function public.risk_audit_log_immutable();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. AFTER INSERT/UPDATE/DELETE trigger on risks
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.risks_audit_capture()
  returns trigger
  language plpgsql
  -- SECURITY DEFINER so it can insert into risk_audit_log even though
  -- the calling user lacks INSERT privilege on the table directly.
  -- (We DO grant INSERT to authenticated below to keep the simpler
  -- path open, but DEFINER is the safe default if grants change.)
  security definer
  set search_path = public
as $$
declare
  v_actor_id    uuid;
  v_actor_email text;
  v_context     text;
begin
  v_actor_id    := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
  v_actor_email := nullif(current_setting('request.jwt.claims', true)::jsonb->>'email', '');
  v_context     := nullif(current_setting('soteria.audit_context', true), '');

  if (tg_op = 'INSERT') then
    insert into public.risk_audit_log (tenant_id, risk_id, event_type, before_row, after_row, actor_id, actor_email, context)
      values (new.tenant_id, new.id, 'insert', null, to_jsonb(new), v_actor_id, v_actor_email, v_context);
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into public.risk_audit_log (tenant_id, risk_id, event_type, before_row, after_row, actor_id, actor_email, context)
      values (new.tenant_id, new.id, 'update', to_jsonb(old), to_jsonb(new), v_actor_id, v_actor_email, v_context);
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.risk_audit_log (tenant_id, risk_id, event_type, before_row, after_row, actor_id, actor_email, context)
      values (old.tenant_id, old.id, 'delete', to_jsonb(old), null, v_actor_id, v_actor_email, v_context);
    return old;
  end if;
  return null;
end $$;

drop trigger if exists trg_risks_audit_capture on public.risks;
create trigger trg_risks_audit_capture
  after insert or update or delete on public.risks
  for each row
  execute function public.risks_audit_capture();

-- Allow the regular auth role to INSERT (the trigger inserts), and
-- SELECT (admins reading the log). RLS in 040 scopes by tenant.
grant insert, select on public.risk_audit_log to authenticated;
grant usage, select on sequence public.risk_audit_log_id_seq to authenticated;

notify pgrst, 'reload schema';

commit;
