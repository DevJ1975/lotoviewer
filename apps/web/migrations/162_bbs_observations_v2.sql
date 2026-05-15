-- Migration 162: Behavioral safety observations (v2 surface).
--
-- Behavior-Based Safety (BBS) under modern EHS practice tracks the
-- safe-to-unsafe observation ratio as a leading indicator of culture.
-- The existing bbs_observations table (migration 081 and friends) was
-- built around a different shape — anonymous-by-default reports, the
-- 3x3 risk matrix, gamified points. That surface is staying as-is.
--
-- This v2 surface tracks the ratio-driven flavor used for daily
-- shop-floor coaching:
--
--   - Required observer (a person, not anonymous).
--   - Required category (safe_behavior / unsafe_act / unsafe_condition).
--   - Recommended hierarchy-of-control level for the corrective action,
--     using the ISO 45001 8.1.2 short form (eliminate, substitute,
--     engineering, administrative, ppe).
--   - Feedback-given timestamp — the act of having the conversation
--     with the observed worker is the BBS intervention.
--   - Follow-up flag + completion timestamp for any condition that
--     needs verifying later (e.g. unsafe condition → maintenance ticket).
--
-- Names with the _v2 suffix to avoid colliding with the existing
-- bbs_* surface, exactly as Module 2 did with incident_capas vs
-- incident_actions. Both surfaces will eventually converge; this one
-- exists today so the rollout can start collecting the ratio metric
-- without forcing the existing surface to change.
--
-- Idempotent.

begin;

create table if not exists public.bbs_observations_v2 (
  id                      uuid        primary key default gen_random_uuid(),
  tenant_id               uuid        not null references public.tenants(id) on delete cascade,
  observer_user_id        uuid        not null references auth.users(id) on delete cascade,
  -- The worker being observed (optional — coaching a crew doesn't
  -- always single out one person). Points at the loto_workers roster
  -- so the entry survives an auth-account churn.
  observed_worker_id      uuid        references public.loto_workers(id) on delete set null,
  location_text           text,
  category                text        not null
                            check (category in ('safe_behavior', 'unsafe_act', 'unsafe_condition')),
  severity                text        not null
                            check (severity in ('minor', 'major', 'critical')),
  description             text        not null
                            check (length(btrim(description)) > 0),
  -- Photo of the observed condition. Stored in loto-photos bucket;
  -- column carries the public URL.
  photo_url               text,
  control_recommendation  text,
  -- Mirrors incident_capas / hazard-controls — the same short form.
  hierarchy_level         text
                            check (hierarchy_level is null
                                   or hierarchy_level in (
                                     'eliminate','substitute','engineering','administrative','ppe')),
  feedback_given_at       timestamptz,
  follow_up_required      boolean     not null default false,
  follow_up_completed_at  timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  -- The follow-up completion timestamp cannot precede the feedback
  -- timestamp — a closure without a conversation isn't a real closure.
  check (
    follow_up_completed_at is null
    or feedback_given_at is null
    or follow_up_completed_at >= feedback_given_at
  )
);

create index if not exists idx_bbs_obs_v2_tenant_created
  on public.bbs_observations_v2(tenant_id, created_at desc);

create index if not exists idx_bbs_obs_v2_followup_due
  on public.bbs_observations_v2(tenant_id, follow_up_completed_at)
  where follow_up_required and follow_up_completed_at is null;

create index if not exists idx_bbs_obs_v2_observer
  on public.bbs_observations_v2(tenant_id, observer_user_id, created_at desc);

comment on table public.bbs_observations_v2 is
  'BBS v2 surface — ratio-driven leading-indicator tracking. Parallel to bbs_observations; the two will converge once the rollout proves out.';

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS — tenant-scoped
-- ────────────────────────────────────────────────────────────────────
alter table public.bbs_observations_v2 enable row level security;

drop policy if exists "bbs_observations_v2_tenant_scope" on public.bbs_observations_v2;
create policy "bbs_observations_v2_tenant_scope"
  on public.bbs_observations_v2
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

-- ────────────────────────────────────────────────────────────────────
-- 3. Audit + touch triggers
-- ────────────────────────────────────────────────────────────────────
drop trigger if exists trg_audit_bbs_observations_v2 on public.bbs_observations_v2;
create trigger trg_audit_bbs_observations_v2
  after insert or update or delete on public.bbs_observations_v2
  for each row execute function public.log_audit('id');

drop trigger if exists trg_bbs_observations_v2_updated_at on public.bbs_observations_v2;
create trigger trg_bbs_observations_v2_updated_at
  before update on public.bbs_observations_v2
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

commit;
