-- Migration 059b: Fold near_misses into incidents.
--
-- The unified incidents table (migration 059) supersedes near_misses.
-- This migration copies every existing near-miss row into incidents
-- with incident_type='near_miss' and preserves the NM-{year}-{seq}
-- report number unchanged so existing links and reports keep working.
--
-- We do NOT drop near_misses here — the API routes under /api/near-miss
-- continue to read it for backwards compat during the transition. A
-- follow-up migration after one full release window will drop the old
-- table once we've confirmed nothing reads it.
--
-- Idempotent: re-running re-uses incidents.legacy_near_miss_id to skip
-- already-folded rows.

begin;

-- Add the back-pointer on the legacy table so the old UI can deep-link
-- into the new incidents/[id] page during the transition. Nullable for
-- the rows that haven't been folded yet (e.g. on a partial restore).
alter table if exists public.near_misses
  add column if not exists migrated_to_incident_id uuid;

create index if not exists idx_near_misses_migrated_to_incident
  on public.near_misses(migrated_to_incident_id)
  where migrated_to_incident_id is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- Severity mapping: near-miss has only severity_potential (low..extreme);
-- the new model adds severity_actual which is always 'none' for a near
-- miss by definition. status maps:
--   new                → reported
--   triaged            → triaged
--   investigating      → investigating
--   closed             → closed
--   escalated_to_risk  → closed (the risk register link is preserved
--                        via linked_risk_id; the incident record is
--                        considered "closed" in the new lifecycle).
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  v_count int;
begin
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential,
    status, assigned_investigator,
    legacy_near_miss_id,
    closed_at, closed_by,
    created_at, updated_at, updated_by
  )
  select
    nm.id,                                  -- preserve UUID — old links keep working
    nm.tenant_id,
    nm.report_number,                       -- keep NM-YYYY-NNNN unchanged
    'near_miss',
    nm.occurred_at, nm.reported_at, nm.reported_by, false,
    nm.location, nm.description, nm.immediate_action_taken,
    'none',                                 -- a near-miss caused no actual harm
    nm.severity_potential,
    case nm.status
      when 'new'                then 'reported'
      when 'triaged'            then 'triaged'
      when 'investigating'      then 'investigating'
      when 'closed'             then 'closed'
      when 'escalated_to_risk'  then 'closed'
      else 'reported'
    end,
    nm.assigned_to,
    nm.id,                                  -- legacy_near_miss_id = old UUID
    nm.resolved_at,
    case when nm.resolved_at is not null then nm.updated_by end,
    nm.created_at, nm.updated_at, nm.updated_by
  from public.near_misses nm
  left join public.incidents inc on inc.legacy_near_miss_id = nm.id
  where inc.id is null;

  get diagnostics v_count = row_count;
  raise notice 'migration 059b: folded % near-miss rows into incidents', v_count;

  -- Back-fill the migrated_to_incident_id pointer for every legacy row
  -- (idempotent — safe to re-run).
  update public.near_misses nm
     set migrated_to_incident_id = inc.id
    from public.incidents inc
   where inc.legacy_near_miss_id = nm.id
     and (nm.migrated_to_incident_id is null
          or nm.migrated_to_incident_id <> inc.id);
end $$;

notify pgrst, 'reload schema';

commit;
