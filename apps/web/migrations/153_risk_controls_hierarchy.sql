-- Migration 153: Risk controls hierarchy view + near-miss linkage notes.
--
-- The existing risk_controls table (migration 037) already carries a
-- `hierarchy_level` column with values
-- elimination/substitution/engineering/administrative/ppe. The
-- @soteria/core/hazardControls helper normalises that against the
-- ISO 45001 8.1.2 short form (eliminate/substitute/...) so the
-- platform can speak either name without schema churn.
--
-- This migration adds:
--   risk_controls_hierarchy   view that joins controls to a
--                             normalized hierarchy key (short form).
--                             Powers the stacked-bar / labeled-list
--                             on risk detail without an N-way join in
--                             the UI.
--
--   near_misses.escalated_to_risk_id
--                             Convenience alias FK that mirrors the
--                             existing linked_risk_id. Provided
--                             because the spec asks for that name —
--                             the trigger keeps the two columns in
--                             sync so external callers can use
--                             either.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. View — risk_controls_hierarchy
-- ────────────────────────────────────────────────────────────────────
-- The case expression maps the DB's long form to the ISO short form.
-- Future cleanup: collapse the underlying check constraint to short
-- form too, but doing that here would invalidate every existing row
-- in production. Keeping the long form alive for storage and the
-- short form alive for analytics is the minimum-risk path.

create or replace view public.risk_controls_hierarchy as
select
  rc.id,
  rc.tenant_id,
  rc.risk_id,
  rc.control_id,
  rc.custom_name,
  rc.hierarchy_level                    as hierarchy_level_long,
  case rc.hierarchy_level
    when 'elimination'    then 'eliminate'
    when 'substitution'   then 'substitute'
    when 'engineering'    then 'engineering'
    when 'administrative' then 'administrative'
    when 'ppe'            then 'ppe'
    else rc.hierarchy_level
  end                                    as hierarchy_level,
  rc.status,
  rc.notes,
  rc.implemented_at,
  rc.verified_at,
  rc.created_at,
  rc.updated_at
from public.risk_controls rc;

comment on view public.risk_controls_hierarchy is
  'risk_controls with hierarchy_level normalized to the ISO 45001 8.1.2 short form (eliminate/substitute/...) for analytics. hierarchy_level_long carries the original storage value.';

-- ────────────────────────────────────────────────────────────────────
-- 2. near_misses.escalated_to_risk_id — alias for linked_risk_id
-- ────────────────────────────────────────────────────────────────────
alter table public.near_misses
  add column if not exists escalated_to_risk_id uuid references public.risks(id) on delete set null;

-- Backfill from the existing column. Idempotent.
update public.near_misses
   set escalated_to_risk_id = linked_risk_id
 where escalated_to_risk_id is null
   and linked_risk_id      is not null;

-- Keep the two columns in lockstep going forward. The trigger fires
-- on both INSERT and UPDATE so any code path that writes one column
-- ends up with both populated.
create or replace function public.near_miss_sync_risk_escalation()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
begin
  -- linked_risk_id is the canonical source; if a caller sets ONLY
  -- escalated_to_risk_id we mirror it back. NULL on both sides is fine.
  if new.linked_risk_id is null and new.escalated_to_risk_id is not null then
    new.linked_risk_id := new.escalated_to_risk_id;
  elsif new.escalated_to_risk_id is null and new.linked_risk_id is not null then
    new.escalated_to_risk_id := new.linked_risk_id;
  elsif new.linked_risk_id is not null
        and new.escalated_to_risk_id is not null
        and new.linked_risk_id <> new.escalated_to_risk_id then
    raise exception 'linked_risk_id and escalated_to_risk_id must point at the same risk';
  end if;
  return new;
end $$;

drop trigger if exists trg_near_miss_sync_risk_escalation on public.near_misses;
create trigger trg_near_miss_sync_risk_escalation
  before insert or update of linked_risk_id, escalated_to_risk_id
  on public.near_misses
  for each row execute function public.near_miss_sync_risk_escalation();

create index if not exists idx_near_misses_escalated_to_risk
  on public.near_misses(escalated_to_risk_id) where escalated_to_risk_id is not null;

notify pgrst, 'reload schema';

commit;
