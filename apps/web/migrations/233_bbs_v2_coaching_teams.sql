-- Migration 233: BBS v2 coaching, recognition, rapid review + action teams.
--
-- Extends the ratio-driven BBS v2 surface (migration 162) with four
-- additive concepts drawn from the Workplace Learning System (WLS)
-- behavior-based-safety methodology, all kept inside the existing v2
-- surface (no Incidents-module changes, no new module):
--
--   1. C.A.R.E.S. coaching + a structured safe-behavior checklist.
--      behavior_tags: a small, app-owned set of behavior categories the
--      observer ticks (ppe, line_of_fire, tools_equipment, procedures,
--      housekeeping, ergonomics). Stored as text[] — the catalog lives
--      in code (@soteria/core), so we only persist the stable keys.
--      coaching_notes: free-text C.A.R.E.S. note for the conversation.
--   2. Positive recognition. recognized flags a safe behavior worth
--      surfacing in the recognition feed (safe behaviors only).
--   3. Care Management "Hot Seat" rapid review. rapid_review_required
--      is auto-set for critical unsafe observations at capture;
--      rapid_review_completed_at records the review. The dashboard
--      counts due vs overdue against a 24h SLA. These timestamps are
--      INDEPENDENT of the feedback/follow-up pair — a rapid review can
--      complete before any coaching conversation, so they deliberately
--      do NOT participate in migration 162's feedback/follow-up CHECK.
--   4. Safety Action Teams. bbs_action_teams is a tenant-scoped lookup
--      (mirrors loto_contractor_companies, migration 144); observations
--      carry an optional action_team_id so follow-ups group by team.
--
-- Every column is additive (nullable / safe-defaulted) so the existing
-- direct-RLS insert from /bbs/observe keeps working unchanged.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. bbs_action_teams — tenant-scoped lookup (mirror migration 144)
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.bbs_action_teams (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  name        text        not null check (length(btrim(name)) > 0),
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One team name per tenant while active. Allows reusing a name after a
-- team is disabled (set active = false then re-add).
create unique index if not exists idx_bbs_action_team_name_active
  on public.bbs_action_teams(tenant_id, lower(name))
  where active;

comment on table public.bbs_action_teams is
  'Safety Action Teams — tenant-scoped lookup. Observations reference a team via bbs_observations_v2.action_team_id so follow-ups group by team.';

alter table public.bbs_action_teams enable row level security;

drop policy if exists "bbs_action_teams_tenant_scope" on public.bbs_action_teams;
create policy "bbs_action_teams_tenant_scope"
  on public.bbs_action_teams
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_bbs_action_teams on public.bbs_action_teams;
create trigger trg_audit_bbs_action_teams
  after insert or update or delete on public.bbs_action_teams
  for each row execute function public.log_audit('id');

drop trigger if exists trg_bbs_action_teams_updated_at on public.bbs_action_teams;
create trigger trg_bbs_action_teams_updated_at
  before update on public.bbs_action_teams
  for each row execute function public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- 2. Additive columns on bbs_observations_v2
-- ────────────────────────────────────────────────────────────────────
alter table public.bbs_observations_v2
  add column if not exists behavior_tags             text[],
  add column if not exists coaching_notes            text,
  add column if not exists recognized                boolean not null default false,
  add column if not exists rapid_review_required     boolean not null default false,
  add column if not exists rapid_review_completed_at timestamptz,
  add column if not exists action_team_id            uuid
    references public.bbs_action_teams(id) on delete set null;

comment on column public.bbs_observations_v2.behavior_tags is
  'Safe-behavior checklist keys (catalog lives in @soteria/core/bbsMetricsV2). text[] for GIN-indexed set membership + per-tag counts.';
comment on column public.bbs_observations_v2.rapid_review_required is
  'WLS "Hot Seat" — auto-set for critical unsafe observations; rapid_review_completed_at closes the 24h review.';

-- ────────────────────────────────────────────────────────────────────
-- 3. Indexes for the new access paths (mirror 162's partial style)
-- ────────────────────────────────────────────────────────────────────
create index if not exists idx_bbs_obs_v2_behavior_tags
  on public.bbs_observations_v2 using gin(behavior_tags);

create index if not exists idx_bbs_obs_v2_rapid_review_due
  on public.bbs_observations_v2(tenant_id, created_at)
  where rapid_review_required and rapid_review_completed_at is null;

create index if not exists idx_bbs_obs_v2_recognized
  on public.bbs_observations_v2(tenant_id, created_at desc)
  where recognized;

create index if not exists idx_bbs_obs_v2_action_team
  on public.bbs_observations_v2(tenant_id, action_team_id)
  where action_team_id is not null;

-- ────────────────────────────────────────────────────────────────────
-- 4. CHECK constraints (idempotent; table pre-exists so add via guard)
-- ────────────────────────────────────────────────────────────────────
-- A review can't be completed unless one was required.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bbs_obs_v2_rapid_review_completed_requires_flag'
  ) then
    alter table public.bbs_observations_v2
      add constraint bbs_obs_v2_rapid_review_completed_requires_flag
      check (rapid_review_completed_at is null or rapid_review_required);
  end if;
end $$;

-- Recognition is for safe behaviors only — a "recognized unsafe act"
-- is an illegal state.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bbs_obs_v2_recognized_safe_only'
  ) then
    alter table public.bbs_observations_v2
      add constraint bbs_obs_v2_recognized_safe_only
      check (not recognized or category = 'safe_behavior');
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
