-- Migration 063: Incident corrective + preventive actions (CAPA).
--
-- One incident can spawn many actions. Each action has:
--   - An owner (the user accountable for completion)
--   - A type (corrective | preventive | interim) and place in the
--     hierarchy of controls (elimination > substitution > engineering >
--     administrative > PPE)
--   - A due date (nullable for "as-soon-as" items)
--   - A status lifecycle: open → in_progress → complete → verified
--     (with cancel/blocked side-states)
--   - Optional verification evidence + verifier (closure auditor)
--   - Optional source_rca_node_id pointing back at the RCA node that
--     justified this action — drives a "what actions came from this
--     finding?" view in the lessons-learned library (Phase 6).
--
-- The hierarchy_of_controls column is meaningful for the scorecard
-- (Phase 5): tenants whose CAPA mix skews PPE-heavy are taking
-- shortcuts; the better mix has elimination + engineering controls
-- at the top. Surfacing this distribution is a leading indicator of
-- safety program maturity.

begin;

create table if not exists public.incident_actions (
  id                      uuid not null primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  incident_id             uuid not null references public.incidents(id) on delete cascade,

  action_type             text not null check (action_type in (
    'corrective','preventive','interim')),
  hierarchy_of_controls   text check (hierarchy_of_controls is null or hierarchy_of_controls in (
    'elimination','substitution','engineering','administrative','ppe')),

  description             text not null,
  owner_user_id           uuid references auth.users(id),
  due_at                  timestamptz,

  status                  text not null default 'open' check (status in (
    'open','in_progress','blocked','complete','verified','cancelled')),

  -- Set when status crosses into 'complete' (the owner says "done").
  completed_at            timestamptz,
  -- Set when a different person validates the work — separation of
  -- duty so the closer can't sign off on their own work.
  verified_at             timestamptz,
  verified_by             uuid references auth.users(id),
  verification_evidence   text,

  -- Soft link to the RCA node that justified this action. We don't
  -- add an FK because a single source_rca_node_id might point at any
  -- of the four RCA tables — typed as uuid only, validated at the
  -- API layer when needed.
  source_rca_node_id      uuid,

  -- Cancellation reason (when status='cancelled').
  cancel_reason           text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id),
  updated_by              uuid references auth.users(id),

  -- Closure invariants:
  --   complete  must have completed_at
  --   verified  must have verified_at + verified_by + completed_at
  --   open / in_progress / blocked must NOT have completed_at
  check (
    (status in ('complete','verified') and completed_at is not null)
    or (status not in ('complete','verified') and completed_at is null)
  ),
  check (
    (status = 'verified' and verified_at is not null and verified_by is not null)
    or (status <> 'verified')
  )
);

-- "My open CAPAs" — fetched on every login. Index covers the common
-- triple filter (owner + status + due_at) so the home panel renders
-- in one round-trip.
create index if not exists idx_incident_actions_owner_status_due
  on public.incident_actions(tenant_id, owner_user_id, status, due_at)
  where status not in ('verified','cancelled');

create index if not exists idx_incident_actions_incident
  on public.incident_actions(incident_id, due_at);

create index if not exists idx_incident_actions_due
  on public.incident_actions(tenant_id, due_at)
  where status not in ('verified','cancelled') and due_at is not null;

drop trigger if exists trg_incident_actions_touch on public.incident_actions;
create trigger trg_incident_actions_touch
  before update on public.incident_actions
  for each row
  execute function public.touch_updated_at();

alter table public.incident_actions enable row level security;

drop policy if exists incident_actions_tenant_scope on public.incident_actions;
create policy incident_actions_tenant_scope on public.incident_actions
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

notify pgrst, 'reload schema';

commit;
