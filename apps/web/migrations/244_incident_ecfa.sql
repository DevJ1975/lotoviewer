-- Migration 244: Events & Causal Factors Analysis (ECFA).
--
-- Adds a self-contained ECFA tool that runs ALONGSIDE the existing RCA
-- methods (it is not a fifth rca_method). ECFA charts the chronological
-- story of an incident — a primary left→right line of EVENTS, CONDITIONS
-- attached above/below the events they modify, and one terminal loss/
-- INCIDENT node — then flags the CAUSAL FACTORS that, if corrected, would
-- have prevented or mitigated the loss.
--
-- Two CSP conventions are first-class in the schema:
--   1. Evidence discipline. verification_status separates VERIFIED fact
--      from PRESUMPTIVE assumption so the chart shows what still needs
--      proof (rendered dashed vs solid).
--   2. Systemic coding. A flagged causal factor is characterized by its
--      category (reusing the ICAM layer taxonomy from migration 062), the
--      failed/missing barrier, and the hierarchy-of-controls level of the
--      fix — the trendable signal the scorecard aggregates. ECFA is
--      self-contained: a causal factor turns directly into a tracked CAPA
--      (incident_actions.source_ecfa_node_id), no separate RCA drill-down.
--
-- AI provenance mirrors migration 236: ai_origin / ai_edited on the node,
-- and an incident_ecfa_ai_suggestions log of every co-pilot proposal vs.
-- what a human accepted (nothing is written until a person accepts).
--
-- Idempotent: guarded with `if not exists` / `add column if not exists`.

begin;

-- ── 1. ECFA chart nodes ───────────────────────────────────────────────
-- One row per chart item. node_type discriminates shape/role:
--   event     — a discrete happening on the timeline (rectangle).
--   condition — a state/circumstance that shaped an event (oval);
--               parent_event_id binds it to the event it modifies, and
--               lane places it above or below the line.
--   incident  — the terminal loss (diamond); at most one is expected but
--               not DB-enforced (the app keeps it single).
-- sequence_index orders events left→right (the stable sort key).
-- Causal-factor coding columns are populated only when is_causal_factor.
create table if not exists public.incident_ecfa_nodes (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  investigation_id    uuid not null references public.incident_investigations(id) on delete cascade,

  node_type           text not null check (node_type in ('event','condition','incident')),
  sequence_index      int  not null default 0,
  -- Set on conditions to bind them to the event they modify. Self-ref so
  -- a condition cascade-deletes with its event. NULL for events + the
  -- terminal incident.
  parent_event_id     uuid references public.incident_ecfa_nodes(id) on delete cascade,
  lane                text check (lane is null or lane in ('above','below')),

  title               text not null check (length(btrim(title)) between 1 and 300),
  description         text,
  -- Optional timestamp label for the time axis; the chart still orders by
  -- sequence_index (times are frequently approximate during an inquiry).
  occurred_at         timestamptz,

  verification_status text not null default 'presumptive'
    check (verification_status in ('presumptive','verified')),

  is_causal_factor    boolean not null default false,
  -- Causal-factor coding — same taxonomy as the ICAM layers (migration
  -- 062) so causal factors are trendable across methods. Nullable; only
  -- meaningful when is_causal_factor.
  cf_category         text check (cf_category is null or cf_category in (
    'absent_failed_defences','individual_team_actions',
    'task_environmental_conditions','organisational_factors')),
  failed_barrier      text,
  cf_hierarchy_control text check (cf_hierarchy_control is null or cf_hierarchy_control in (
    'elimination','substitution','engineering','administrative','ppe')),

  -- AI provenance (see migration 236): drafted by Claude / edited by a
  -- human before saving. Both default false (manual entry).
  ai_origin           boolean not null default false,
  ai_edited           boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

-- RLS filters by tenant_id; the editor reads a whole investigation's
-- nodes ordered along the line and assembles conditions under their event.
create index if not exists idx_incident_ecfa_nodes_tenant
  on public.incident_ecfa_nodes(tenant_id);
create index if not exists idx_incident_ecfa_nodes_investigation
  on public.incident_ecfa_nodes(investigation_id, sequence_index);
create index if not exists idx_incident_ecfa_nodes_parent
  on public.incident_ecfa_nodes(investigation_id, parent_event_id);

drop trigger if exists trg_incident_ecfa_nodes_touch on public.incident_ecfa_nodes;
create trigger trg_incident_ecfa_nodes_touch
  before update on public.incident_ecfa_nodes
  for each row
  execute function public.touch_updated_at();

alter table public.incident_ecfa_nodes enable row level security;

drop policy if exists incident_ecfa_nodes_tenant_scope on public.incident_ecfa_nodes;
create policy incident_ecfa_nodes_tenant_scope on public.incident_ecfa_nodes
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

-- ── 2. AI-suggestion log ──────────────────────────────────────────────
-- Append-mostly. One row per co-pilot call. `accepted` flips true when a
-- human commits the suggestion (the route never auto-writes nodes —
-- acceptance happens through the normal POSTs). jsonb keeps the shape
-- flexible across the two modes (draft_sequence, suggest_causal_factors).
create table if not exists public.incident_ecfa_ai_suggestions (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  investigation_id  uuid not null references public.incident_investigations(id) on delete cascade,
  mode              text not null check (mode in ('draft_sequence','suggest_causal_factors')),
  suggestion        jsonb not null,
  model             text not null,
  accepted          boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists idx_incident_ecfa_ai_suggestions_investigation
  on public.incident_ecfa_ai_suggestions(investigation_id, created_at desc);

alter table public.incident_ecfa_ai_suggestions enable row level security;

drop policy if exists incident_ecfa_ai_suggestions_tenant_scope on public.incident_ecfa_ai_suggestions;
create policy incident_ecfa_ai_suggestions_tenant_scope on public.incident_ecfa_ai_suggestions
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

-- ── 3. Causal factor → CAPA soft link ─────────────────────────────────
-- Mirrors incident_actions.source_rca_node_id (migration 063): the action
-- points back at the ECFA causal-factor node that justified it, driving
-- the completeness gate ("every causal factor needs a corrective action")
-- and a future "what came from this finding?" view. Typed uuid, no FK
-- (parallels the RCA soft link).
alter table public.incident_actions
  add column if not exists source_ecfa_node_id uuid;

notify pgrst, 'reload schema';

commit;
