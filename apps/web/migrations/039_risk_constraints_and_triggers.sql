-- Migration 039: Risk Assessment constraints + triggers.
--
-- Three concerns, three sections:
--
--   1. risk_number auto-generation. Pattern: RSK-{year}-{4-digit
--      tenant-scoped sequence}. Mirrors the permit-signon token
--      pattern from migration 024 — sequence resets per (tenant_id,
--      year) so two tenants never collide on RSK-2026-0001.
--
--   2. PPE-alone enforcement (ISO 45001 8.1.2 + OSHA 1910.132(a)).
--      When inherent_score >= 8 and every linked control has
--      hierarchy_level = 'ppe' AND the risk has no ppe_only_justification,
--      raise an exception. The wizard UI also enforces this for early
--      feedback; this trigger is the auditor-verifiable backstop.
--
--      Implemented as a CONSTRAINT TRIGGER deferrable to commit time
--      because the wizard saves the risk row and the controls in one
--      transaction. Evaluating mid-transaction would reject the
--      first INSERT before the controls are attached.
--
--   3. updated_at maintenance. Reuses public.touch_updated_at()
--      from migration 035; just adds triggers to the new tables.
--
-- Idempotent.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. risk_number generator
-- ──────────────────────────────────────────────────────────────────────────
--
-- A small bookkeeping table tracks the per-tenant per-year counter.
-- One row per (tenant_id, year). The trigger uses an UPSERT to
-- increment atomically.

create table if not exists public.risk_number_sequences (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  year        int  not null,
  next_value  int  not null default 1,
  primary key (tenant_id, year)
);

create or replace function public.set_risk_number()
  returns trigger
  language plpgsql
  security definer                                       -- needs to read/update the sequence table
  set search_path = public
as $$
declare
  v_year int;
  v_seq  int;
begin
  if new.risk_number is not null then
    return new;                                          -- already set (e.g. import from another system)
  end if;

  v_year := extract(year from new.created_at);

  -- Atomic UPSERT-and-increment pattern. The locking semantics of
  -- INSERT ... ON CONFLICT DO UPDATE ... RETURNING guarantee no two
  -- concurrent inserts can grab the same number.
  insert into public.risk_number_sequences (tenant_id, year, next_value)
    values (new.tenant_id, v_year, 2)
    on conflict (tenant_id, year)
      do update set next_value = public.risk_number_sequences.next_value + 1
    returning next_value - 1 into v_seq;

  new.risk_number := format('RSK-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
  return new;
end $$;

drop trigger if exists trg_set_risk_number on public.risks;
create trigger trg_set_risk_number
  before insert on public.risks
  for each row
  execute function public.set_risk_number();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. PPE-alone enforcement
-- ──────────────────────────────────────────────────────────────────────────
--
-- The constraint: a risk with inherent_score >= 8 (i.e. 'high' or
-- 'extreme') cannot have its ENTIRE control set be PPE unless the
-- ppe_only_justification field is non-empty.
--
-- We implement this as a CONSTRAINT TRIGGER deferrable to commit
-- time on:
--   - risks (when ppe_only_justification or inherent_*  changes)
--   - risk_controls (when a control is added / removed / changed)
--
-- Both fire on the same logic; the deferrable behavior means the
-- check runs once at COMMIT, after the wizard's full transaction
-- (insert risk + insert N risk_controls + maybe set justification)
-- has completed. Mid-transaction state can be inconsistent without
-- raising.

create or replace function public.enforce_ppe_alone_rule()
  returns trigger
  language plpgsql
as $$
declare
  v_risk_id          uuid;
  v_inherent_score   int;
  v_justification    text;
  v_total_controls   int;
  v_ppe_controls     int;
begin
  -- The trigger may fire from either table; figure out which risk to check.
  if tg_table_name = 'risks' then
    v_risk_id := coalesce(new.id, old.id);
  else
    v_risk_id := coalesce(new.risk_id, old.risk_id);
  end if;

  select r.inherent_score, r.ppe_only_justification
    into v_inherent_score, v_justification
    from public.risks r
    where r.id = v_risk_id;

  if v_inherent_score is null or v_inherent_score < 8 then
    return null;                                         -- below threshold, nothing to check
  end if;

  select count(*) filter (where true),
         count(*) filter (where rc.hierarchy_level = 'ppe')
    into v_total_controls, v_ppe_controls
    from public.risk_controls rc
    where rc.risk_id = v_risk_id;

  -- No controls yet → defer; the user is mid-edit. The next save
  -- (with controls attached) will trigger the check.
  if v_total_controls = 0 then
    return null;
  end if;

  -- All controls are PPE → require justification.
  if v_ppe_controls = v_total_controls and (v_justification is null or btrim(v_justification) = '') then
    raise exception
      'PPE-alone rule (ISO 45001 8.1.2): risk % has inherent_score=% and only PPE-level controls. Document why higher controls are not feasible in ppe_only_justification.',
      v_risk_id, v_inherent_score
      using errcode = 'check_violation';
  end if;

  return null;
end $$;

-- Constraint triggers run AFTER the row change, can be deferred to
-- end-of-transaction, and respect the SET CONSTRAINTS DEFERRED
-- statement. The wizard's API route should issue
--   begin; SET CONSTRAINTS ALL DEFERRED;
-- before the multi-table INSERT batch — but we mark these as
-- INITIALLY DEFERRED so callers don't have to remember.

drop trigger if exists trg_risks_ppe_alone on public.risks;
create constraint trigger trg_risks_ppe_alone
  after insert or update of inherent_severity, inherent_likelihood, ppe_only_justification on public.risks
  deferrable initially deferred
  for each row
  execute function public.enforce_ppe_alone_rule();

drop trigger if exists trg_risk_controls_ppe_alone on public.risk_controls;
create constraint trigger trg_risk_controls_ppe_alone
  after insert or update or delete on public.risk_controls
  deferrable initially deferred
  for each row
  execute function public.enforce_ppe_alone_rule();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. updated_at triggers
-- ──────────────────────────────────────────────────────────────────────────
--
-- Reuses public.touch_updated_at() from migration 035.

drop trigger if exists trg_risks_touch on public.risks;
create trigger trg_risks_touch
  before update on public.risks
  for each row
  execute function public.touch_updated_at();

drop trigger if exists trg_controls_library_touch on public.controls_library;
create trigger trg_controls_library_touch
  before update on public.controls_library
  for each row
  execute function public.touch_updated_at();

drop trigger if exists trg_risk_controls_touch on public.risk_controls;
create trigger trg_risk_controls_touch
  before update on public.risk_controls
  for each row
  execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
