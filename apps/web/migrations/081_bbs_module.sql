-- Migration 081: Behavior-Based Safety (BBS) module.
--
-- Industry-standard BBS program: workers scan a QR code posted at a
-- location, then submit an observation of an Unsafe Act, Unsafe
-- Condition, or Safe Behavior. Optional ABC analysis (antecedent /
-- behavior / consequence) and a 3x3 risk matrix (severity x likelihood)
-- feed the EHS scorecard. Logged-in submissions earn gamification
-- points which drive a per-tenant leaderboard.
--
-- Anonymous submissions are accepted via per-location HMAC-token URLs
-- routed through a service-role API endpoint (supabaseAdmin); RLS on
-- these tables therefore only needs to cover the authenticated path.
--
-- Multi-tenancy: tenant_id NOT NULL on every table; RLS uses the
-- standard active_tenant_id() + current_user_tenant_ids() pattern
-- introduced in migration 029.
--
-- Idempotent — guarded with `if not exists` / `do $$ ... $$` blocks.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. bbs_qr_locations — physical posts/areas where a QR is displayed
-- ──────────────────────────────────────────────────────────────────────────
--
-- One row per QR sticker. The `token` column is the public secret
-- embedded in the QR's URL: https://app/r/bbs/{token}. It is
-- regenerated whenever a sticker is reprinted (admin action). Soft
-- disable via `active = false` rather than delete so historical
-- observations keep their FK.

create table if not exists public.bbs_qr_locations (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  name         text not null,
  area         text,
  description  text,

  -- 32-char hex token; unique within tenant. Default generated below.
  token        text not null,

  active       boolean not null default true,

  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),

  unique (tenant_id, token)
);

create index if not exists idx_bbs_qr_locations_tenant
  on public.bbs_qr_locations(tenant_id);
create index if not exists idx_bbs_qr_locations_token
  on public.bbs_qr_locations(token);

create or replace function public.bbs_default_qr_token()
  returns trigger
  language plpgsql
as $$
begin
  if new.token is null or new.token = '' then
    new.token := encode(gen_random_bytes(16), 'hex');
  end if;
  return new;
end $$;

drop trigger if exists trg_bbs_qr_locations_default_token on public.bbs_qr_locations;
create trigger trg_bbs_qr_locations_default_token
  before insert on public.bbs_qr_locations
  for each row
  execute function public.bbs_default_qr_token();

drop trigger if exists trg_bbs_qr_locations_touch_updated_at on public.bbs_qr_locations;
create trigger trg_bbs_qr_locations_touch_updated_at
  before update on public.bbs_qr_locations
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. bbs_observations — the report
-- ──────────────────────────────────────────────────────────────────────────
--
-- `kind` is the headline classification (industry standard). Severity
-- and likelihood feed a 9-point risk_score (severity * likelihood,
-- 1..3 each). Status drives the close-out workflow that anchors the
-- weighted scorecard:
--
--   participation = count(*) over the period
--   close_out_rate = closed unsafe_* / total unsafe_*
--   severity_weight = sum(risk_score) / count(*)
--
-- See packages/core/src/bbsMetrics.ts for the composite formula.

create table if not exists public.bbs_observations (
  id                    uuid not null primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,

  -- BBS-{year}-{4-digit tenant-scoped sequence}. Set by trigger.
  report_number         text,

  -- nullable: anonymous QR scans don't have an auth user. The Next.js
  -- API populates `submitted_name` instead.
  submitted_by          uuid references auth.users(id),
  submitted_name        text,
  submitted_email       text,

  -- Where the QR was scanned, if any. Nullable so logged-in users
  -- filing without a QR (e.g. from the desktop) still work.
  qr_location_id        uuid references public.bbs_qr_locations(id) on delete set null,

  observed_at           timestamptz not null default now(),
  location_text         text,
  department            text,

  kind                  text not null check (kind in (
    'unsafe_act','unsafe_condition','safe_behavior')),

  -- Free-text taxonomy (PPE, housekeeping, ergonomics, …). Kept text
  -- rather than enum so tenants can extend.
  category              text,

  description           text not null,
  immediate_action_taken text,

  -- Optional ABC analysis (Antecedent / Behavior / Consequence).
  abc_antecedent        text,
  abc_behavior          text,
  abc_consequence       text,

  -- 3x3 risk matrix. low=1, medium=2, high=3. risk_score = sev*like
  -- (1..9). Computed by trigger. Required for unsafe_*; optional for
  -- safe_behavior.
  severity              text check (severity in ('low','medium','high')),
  likelihood            text check (likelihood in ('low','medium','high')),
  risk_score            int,

  status                text not null default 'open' check (status in (
    'open','in_progress','closed','invalid')),

  -- Close-out workflow.
  assigned_to           uuid references auth.users(id),
  due_date              date,
  corrective_action     text,
  closed_at             timestamptz,
  closed_by             uuid references auth.users(id),

  -- Gamification: points awarded at submission time, frozen even if
  -- scoring formula later changes. See bbs_points_for_kind() below.
  points_awarded        int not null default 0,

  -- Anonymous flag: TRUE iff submitted_by is null. Denormalized so
  -- the leaderboard can `WHERE NOT anonymous` cheaply.
  anonymous             boolean not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id),

  unique (tenant_id, report_number)
);

create index if not exists idx_bbs_obs_tenant
  on public.bbs_observations(tenant_id);
create index if not exists idx_bbs_obs_tenant_status
  on public.bbs_observations(tenant_id, status) where status <> 'closed';
create index if not exists idx_bbs_obs_tenant_kind
  on public.bbs_observations(tenant_id, kind);
create index if not exists idx_bbs_obs_submitted_by
  on public.bbs_observations(submitted_by) where submitted_by is not null;
create index if not exists idx_bbs_obs_assigned
  on public.bbs_observations(assigned_to) where assigned_to is not null;
create index if not exists idx_bbs_obs_observed_at
  on public.bbs_observations(tenant_id, observed_at desc);
create index if not exists idx_bbs_obs_location
  on public.bbs_observations(qr_location_id) where qr_location_id is not null;

-- ── Helpers: severity/likelihood -> score, kind -> points ─────────────────

create or replace function public.bbs_score_for(severity text, likelihood text)
  returns int
  language sql
  immutable
as $$
  select case severity when 'low' then 1 when 'medium' then 2 when 'high' then 3 else null end
       * case likelihood when 'low' then 1 when 'medium' then 2 when 'high' then 3 else null end;
$$;

create or replace function public.bbs_points_for_kind(p_kind text, p_score int)
  returns int
  language sql
  immutable
as $$
  -- Base points per submission, plus a severity bonus for unsafe_*.
  --   safe_behavior     : 5  (positive observation, encourages reporting)
  --   unsafe_condition  : 10 + score (1..9)
  --   unsafe_act        : 10 + score (1..9)
  -- Anonymous submissions still compute a point value; the
  -- leaderboard filter excludes them.
  select case p_kind
    when 'safe_behavior'    then 5
    when 'unsafe_condition' then 10 + coalesce(p_score, 0)
    when 'unsafe_act'       then 10 + coalesce(p_score, 0)
    else 0
  end;
$$;

-- ── Sequence for report_number ────────────────────────────────────────────

create table if not exists public.bbs_number_sequences (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  year        int  not null,
  next_value  int  not null default 1,
  primary key (tenant_id, year)
);

create or replace function public.set_bbs_report_number()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_year int;
  v_seq  int;
begin
  -- Compute risk_score from severity * likelihood whenever both are set.
  new.risk_score := public.bbs_score_for(new.severity, new.likelihood);

  -- Anonymous flag follows submitted_by.
  new.anonymous := (new.submitted_by is null);

  -- Default points if not explicitly provided.
  if new.points_awarded = 0 then
    new.points_awarded := public.bbs_points_for_kind(new.kind, new.risk_score);
  end if;

  if new.report_number is not null then
    return new;
  end if;

  v_year := extract(year from new.created_at);

  insert into public.bbs_number_sequences (tenant_id, year, next_value)
    values (new.tenant_id, v_year, 2)
    on conflict (tenant_id, year)
      do update set next_value = public.bbs_number_sequences.next_value + 1
    returning next_value - 1 into v_seq;

  new.report_number := format('BBS-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
  return new;
end $$;

drop trigger if exists trg_set_bbs_report_number on public.bbs_observations;
create trigger trg_set_bbs_report_number
  before insert on public.bbs_observations
  for each row
  execute function public.set_bbs_report_number();

-- Recompute risk_score on update (severity / likelihood may change
-- during triage). points_awarded is *not* recomputed — it's frozen at
-- submission time.

create or replace function public.bbs_observations_before_update()
  returns trigger
  language plpgsql
as $$
begin
  new.risk_score := public.bbs_score_for(new.severity, new.likelihood);
  new.anonymous  := (new.submitted_by is null);
  -- Auto-stamp closed_at/by when status flips to 'closed' and not set.
  if new.status = 'closed' and old.status <> 'closed' and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_bbs_observations_before_update on public.bbs_observations;
create trigger trg_bbs_observations_before_update
  before update on public.bbs_observations
  for each row
  execute function public.bbs_observations_before_update();

drop trigger if exists trg_bbs_observations_touch_updated_at on public.bbs_observations;
create trigger trg_bbs_observations_touch_updated_at
  before update on public.bbs_observations
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. bbs_observation_photos — attachments
-- ──────────────────────────────────────────────────────────────────────────
--
-- Stored in the existing `loto-photos` bucket under the path
-- `{tenant_id}/bbs/{observation_id}/{filename}` so the same RLS
-- helper (storage_path_tenant) gates them.

create table if not exists public.bbs_observation_photos (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  observation_id  uuid not null references public.bbs_observations(id) on delete cascade,
  file_path       text not null,
  -- Optional shape annotations (arrows / labels) — same JSON shape
  -- as iso/equipment annotations (lib/photoAnnotations.ts).
  annotations     jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index if not exists idx_bbs_obs_photos_observation
  on public.bbs_observation_photos(observation_id);
create index if not exists idx_bbs_obs_photos_tenant
  on public.bbs_observation_photos(tenant_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. bbs_observation_actions — timeline / comments
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.bbs_observation_actions (
  id              bigserial primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  observation_id  uuid not null references public.bbs_observations(id) on delete cascade,
  action_type     text not null check (action_type in (
    'comment','status_change','assigned','closed','reopened')),
  body            text,
  meta            jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index if not exists idx_bbs_obs_actions_observation
  on public.bbs_observation_actions(observation_id, created_at desc);
create index if not exists idx_bbs_obs_actions_tenant
  on public.bbs_observation_actions(tenant_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Leaderboard view — per-user totals (logged-in submissions only)
-- ──────────────────────────────────────────────────────────────────────────
--
-- Views inherit the RLS of their base tables when defined with
-- security_invoker = true (Postgres 15+). All Soteria deployments
-- are on Supabase 15+, so this is the right knob.

create or replace view public.bbs_leaderboard
  with (security_invoker = true)
  as
  select
    o.tenant_id,
    o.submitted_by                           as user_id,
    p.full_name,
    p.avatar_url,
    count(*)::int                            as observation_count,
    coalesce(sum(o.points_awarded), 0)::int  as points_total,
    count(*) filter (where o.kind = 'unsafe_act')::int       as unsafe_act_count,
    count(*) filter (where o.kind = 'unsafe_condition')::int as unsafe_condition_count,
    count(*) filter (where o.kind = 'safe_behavior')::int    as safe_behavior_count,
    max(o.created_at)                                        as last_submitted_at
  from public.bbs_observations o
  left join public.profiles p on p.id = o.submitted_by
  where o.submitted_by is not null
    and o.status <> 'invalid'
  group by o.tenant_id, o.submitted_by, p.full_name, p.avatar_url;

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Row-Level Security
-- ──────────────────────────────────────────────────────────────────────────
--
-- Anonymous submissions are accepted server-side via the service-role
-- key after the QR token has been validated; they don't pass through
-- these policies. Only the authenticated path needs RLS.

alter table public.bbs_qr_locations           enable row level security;
alter table public.bbs_observations           enable row level security;
alter table public.bbs_observation_photos     enable row level security;
alter table public.bbs_observation_actions    enable row level security;

drop policy if exists bbs_qr_locations_tenant on public.bbs_qr_locations;
create policy bbs_qr_locations_tenant on public.bbs_qr_locations
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

drop policy if exists bbs_observations_tenant on public.bbs_observations;
create policy bbs_observations_tenant on public.bbs_observations
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

drop policy if exists bbs_obs_photos_tenant on public.bbs_observation_photos;
create policy bbs_obs_photos_tenant on public.bbs_observation_photos
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

drop policy if exists bbs_obs_actions_tenant on public.bbs_observation_actions;
create policy bbs_obs_actions_tenant on public.bbs_observation_actions
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
