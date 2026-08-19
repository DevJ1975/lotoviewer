-- 256_incident_pii_investigation_team.sql
--
-- can_view_incident_pii() has never honoured the investigation team, even
-- though migration 062 says it does:
--
--   062_incident_investigations.sql:47
--   "team_member_ids ... is used by the can_view_incident_pii() helper in
--    migration 060 to elevate team members above plain tenant role"
--
-- The 060 body checks superadmin, owner/admin, and incidents.assigned_
-- investigator only. So the documented behaviour does not exist: a lead
-- investigator who is not also the incident's assigned_investigator sees
-- redacted PII on the case they are running, and named team members never
-- get the elevation the schema comment promises.
--
-- can_view_care_phi() (migration 201) inherited the same blind spot, so the
-- same investigator is refused care data at the data layer too.
--
-- This migration makes both helpers match their documentation. It widens
-- access to two roles that are already trusted with the investigation, and
-- changes nothing else — in particular it does NOT address the larger gap
-- that incident_people's PII columns are reachable directly through
-- PostgREST regardless of these helpers. See
-- docs/incident-people-pii-plan.md for that, which needs a design decision
-- rather than a patch.
--
-- Idempotent: both functions are CREATE OR REPLACE.

begin;

-- ── 1. PII helper: add lead investigator + named team members ──────────

create or replace function public.can_view_incident_pii(p_incident_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(public.is_superadmin(), false)
  or exists (
    select 1
      from public.incidents i
      join public.tenant_memberships m
        on m.tenant_id = i.tenant_id
       and m.user_id   = auth.uid()
     where i.id = p_incident_id
       and m.role in ('owner','admin')
  )
  or exists (
    select 1
      from public.incidents i
     where i.id = p_incident_id
       and i.assigned_investigator = auth.uid()
  )
  -- The people actually running the investigation: its lead, and anyone
  -- named on the team. Both are set by an admin on the investigation row,
  -- so this does not let a member elevate themselves.
  or exists (
    select 1
      from public.incident_investigations inv
     where inv.incident_id = p_incident_id
       and (
         inv.lead_investigator = auth.uid()
         or auth.uid() = any(coalesce(inv.team_member_ids, '{}'::uuid[]))
       )
  );
$$;

-- ── 2. Care PHI helper: same two roles ─────────────────────────────────

create or replace function public.can_view_care_phi(p_incident_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select coalesce(public.is_superadmin(), false)
  or exists (
    select 1
      from public.incidents i
      join public.tenant_memberships m
        on m.tenant_id = i.tenant_id
       and m.user_id   = auth.uid()
     where i.id = p_incident_id
       and m.role in ('owner','admin')
  )
  or exists (
    select 1
      from public.incidents i
     where i.id = p_incident_id
       and i.assigned_investigator = auth.uid()
  )
  or exists (
    select 1
      from public.incident_care_cases c
     where c.incident_id = p_incident_id
       and c.case_manager_user_id = auth.uid()
  )
  or exists (
    select 1
      from public.incident_investigations inv
     where inv.incident_id = p_incident_id
       and (
         inv.lead_investigator = auth.uid()
         or auth.uid() = any(coalesce(inv.team_member_ids, '{}'::uuid[]))
       )
  );
$$;

-- Supporting index: both helpers now look up an investigation by incident.
-- incident_investigations has a unique (incident_id) key from 062, so the
-- lookup is already served — this is a no-op guard in case that changes.
create index if not exists idx_incident_investigations_incident
  on public.incident_investigations(incident_id);

commit;
