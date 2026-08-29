-- Migration 236: RCA multi-root + 5-Whys branching + AI provenance.
--
-- Rebuilds the 5 Whys / RCA tool to address direct user feedback that it
-- "is not a good tool." Three schema changes, all additive and backward
-- compatible:
--
--   1. MULTIPLE ROOTS. The old behaviour cleared every other is_root flag
--      when a node was marked root (enforced in the API route, not the
--      DB). Real incidents have several contributing root causes; we now
--      allow many is_root=true rows. No DB constraint changes here — the
--      single-root clear lived in app code (see rca/route.ts) and is
--      removed there. Existing single-root rows stay valid.
--
--   2. 5-WHYS BRANCHING. A nullable self-referencing parent_id lets one
--      "why" interrogate a specific prior answer, so an investigation can
--      fork into several causal lines instead of one flat chain. `ordinal`
--      stays a GLOBAL per-investigation sequence (its existing
--      unique(investigation_id, ordinal) constraint is untouched) and
--      remains the stable sort key; parent_id is the orthogonal tree
--      dimension. Legacy rows get parent_id=NULL and render as one linear
--      chain — no data migration required.
--
--   3. AI PROVENANCE. ai_origin / ai_edited booleans record that a node or
--      action was drafted by Claude and whether a human edited it before
--      saving — the visible trust signal behind "AI-assisted, human
--      approved." Added to incident_rca_5whys (the AI-assisted surface) and
--      incident_actions (AI-drafted corrective actions). The
--      incident_rca_ai_suggestions log captures every proposal the model
--      returned vs. what a human accepted, for audit + future tuning.
--
-- Idempotent: guarded with `if not exists` / `add column if not exists`.

begin;

-- ── 1+2. 5 Whys: branching parent + AI provenance ─────────────────────
alter table public.incident_rca_5whys
  add column if not exists parent_id  uuid
    references public.incident_rca_5whys(id) on delete cascade,
  add column if not exists ai_origin  boolean not null default false,
  add column if not exists ai_edited  boolean not null default false;

-- Children-of-a-node lookups + tree assembly on read.
create index if not exists idx_rca_5whys_parent
  on public.incident_rca_5whys(investigation_id, parent_id);

-- ── 3. AI provenance on corrective actions ────────────────────────────
alter table public.incident_actions
  add column if not exists ai_origin  boolean not null default false,
  add column if not exists ai_edited  boolean not null default false;

-- ── 4. AI-suggestion log ──────────────────────────────────────────────
-- Append-mostly. One row per assist call. `accepted` flips true when the
-- human commits the suggestion (the route does not auto-write RCA nodes /
-- actions — acceptance happens through the normal POSTs). jsonb keeps the
-- shape flexible across the two modes (next_why, draft_root_and_actions).
create table if not exists public.incident_rca_ai_suggestions (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  investigation_id  uuid not null references public.incident_investigations(id) on delete cascade,
  mode              text not null check (mode in ('next_why','draft_root_and_actions')),
  suggestion        jsonb not null,
  model             text not null,
  accepted          boolean not null default false,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create index if not exists idx_rca_ai_suggestions_investigation
  on public.incident_rca_ai_suggestions(investigation_id, created_at desc);

alter table public.incident_rca_ai_suggestions enable row level security;

drop policy if exists incident_rca_ai_suggestions_tenant_scope on public.incident_rca_ai_suggestions;
create policy incident_rca_ai_suggestions_tenant_scope on public.incident_rca_ai_suggestions
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
