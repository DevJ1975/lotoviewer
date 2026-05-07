-- Migration 062: Incident investigations + four RCA method tables.
--
-- One investigation per incident (1:1, enforced by unique constraint on
-- incident_id). The investigation row carries the lifecycle metadata
-- (lead, team, sequence-of-events, signoff). The chosen rca_method
-- discriminates which of the four detail tables holds the analysis.
--
-- RCA tables:
--   incident_rca_5whys             ordinal Q&A chain. is_root=true on the
--                                  identified root.
--   incident_rca_fishbone          rows tagged with one of the six
--                                  Ishikawa categories.
--   incident_rca_taproot_factors   self-referencing tree (parent_id) of
--                                  causal factors / root causes / generic
--                                  causes.
--   incident_rca_icam_factors      rows tagged with one of the four
--                                  ICAM layers.
--
-- Audit log: investigation rows + RCA rows are mutable user-facing data;
-- the existing incident_audit_log captures status changes on incidents.
-- For the per-investigation history we rely on the touch_updated_at
-- trigger + Sentry log on PATCH — full audit log per RCA node is
-- overkill for Phase 2.
--
-- Idempotent: guarded with `if not exists`.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. incident_investigations — the per-incident dossier.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_investigations (
  id                       uuid not null primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  -- Exactly one investigation per incident.
  incident_id              uuid not null unique references public.incidents(id) on delete cascade,

  rca_method               text not null default 'none_yet' check (rca_method in (
    '5_whys','fishbone','taproot','icam','none_yet')),

  began_at                 timestamptz,
  target_close_at          timestamptz,
  completed_at             timestamptz,

  lead_investigator        uuid references auth.users(id),
  -- Multi-investigator team. Used by the can_view_incident_pii() helper
  -- in migration 060 to elevate team members above plain tenant role.
  team_member_ids          uuid[] not null default array[]::uuid[],

  scope_summary            text,
  -- Free-text "what happened, in order" — usually one paragraph
  -- describing the timeline. The investigation page surfaces this
  -- prominently above the RCA tab.
  sequence_of_events       text,
  immediate_causes         text,
  underlying_causes        text,
  root_causes              text,
  lessons_learned          text,

  -- Signoff. The lead investigator (or a different signer) types their
  -- name + the timestamp is captured. Phase 1 doesn't render a real
  -- signature pad — Phase 4 does.
  signoff_by               uuid references auth.users(id),
  signoff_at               timestamptz,
  signoff_typed_name       text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references auth.users(id),
  updated_by               uuid references auth.users(id),

  -- Both signoff fields together or neither.
  check ((signoff_at is null) = (signoff_by is null)),
  -- Completed implies began.
  check (completed_at is null or began_at is not null)
);

create index if not exists idx_incident_investigations_tenant
  on public.incident_investigations(tenant_id);
create index if not exists idx_incident_investigations_lead
  on public.incident_investigations(lead_investigator) where lead_investigator is not null;
-- Investigations begun but not completed — used by the SLA cron to find
-- overdue investigations.
create index if not exists idx_incident_investigations_open
  on public.incident_investigations(target_close_at)
  where began_at is not null and completed_at is null;

drop trigger if exists trg_incident_investigations_touch on public.incident_investigations;
create trigger trg_incident_investigations_touch
  before update on public.incident_investigations
  for each row
  execute function public.touch_updated_at();

alter table public.incident_investigations enable row level security;

drop policy if exists incident_investigations_tenant_scope on public.incident_investigations;
create policy incident_investigations_tenant_scope on public.incident_investigations
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

-- ──────────────────────────────────────────────────────────────────────────
-- 2. RCA detail tables — one per supported method.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Common columns: tenant_id (for RLS scope), investigation_id (cascade
-- delete on investigation removal), ordinal (display order), is_root
-- (which node the user identified as the root cause), created_at /
-- updated_at.

-- ── 5 Whys ────────────────────────────────────────────────────────────
create table if not exists public.incident_rca_5whys (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  investigation_id  uuid not null references public.incident_investigations(id) on delete cascade,
  ordinal           int  not null,                  -- 1..N (the Nth "why")
  question          text,                            -- prompt the user typed (often "Why?")
  answer            text not null,
  is_root           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (investigation_id, ordinal)
);

create index if not exists idx_rca_5whys_investigation
  on public.incident_rca_5whys(investigation_id, ordinal);

drop trigger if exists trg_rca_5whys_touch on public.incident_rca_5whys;
create trigger trg_rca_5whys_touch
  before update on public.incident_rca_5whys
  for each row
  execute function public.touch_updated_at();

-- ── Fishbone (Ishikawa) ───────────────────────────────────────────────
create table if not exists public.incident_rca_fishbone (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  investigation_id  uuid not null references public.incident_investigations(id) on delete cascade,
  category          text not null check (category in (
    'people','process','equipment','environment','materials','management')),
  cause             text not null,
  ordinal           int  not null default 0,
  is_root           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_rca_fishbone_investigation
  on public.incident_rca_fishbone(investigation_id, category, ordinal);

drop trigger if exists trg_rca_fishbone_touch on public.incident_rca_fishbone;
create trigger trg_rca_fishbone_touch
  before update on public.incident_rca_fishbone
  for each row
  execute function public.touch_updated_at();

-- ── TapRooT (causal factor tree) ──────────────────────────────────────
-- Self-referencing tree: parent_id is null for the top of the tree
-- (the event), then conditions / causal_factor / root_cause / generic
-- cause descend. Generic-cause classification (training, procedures,
-- HPI, etc.) lets a tenant see "we have X 'training' root causes
-- across our incidents this year" in the lessons-learned library
-- (Phase 6).
create table if not exists public.incident_rca_taproot_factors (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  investigation_id  uuid not null references public.incident_investigations(id) on delete cascade,
  parent_id         uuid references public.incident_rca_taproot_factors(id) on delete cascade,
  factor_type       text not null check (factor_type in (
    'event','condition','causal_factor','root_cause','generic_cause')),
  description       text not null,
  -- Generic-cause taxonomy from the TapRooT manual. Free-text within
  -- this column lets us capture sub-categories without a giant enum.
  taproot_category  text,                            -- 'training','procedures','HPI','communication',...
  ordinal           int  not null default 0,
  is_root           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_rca_taproot_investigation
  on public.incident_rca_taproot_factors(investigation_id, parent_id);

drop trigger if exists trg_rca_taproot_touch on public.incident_rca_taproot_factors;
create trigger trg_rca_taproot_touch
  before update on public.incident_rca_taproot_factors
  for each row
  execute function public.touch_updated_at();

-- ── ICAM (Incident Cause Analysis Method) ─────────────────────────────
-- Four-layer model: absent/failed defences ⇒ individual/team actions ⇒
-- task/environmental conditions ⇒ organisational factors. Each row
-- pairs a factor with optional supporting evidence.
create table if not exists public.incident_rca_icam_factors (
  id                uuid not null primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  investigation_id  uuid not null references public.incident_investigations(id) on delete cascade,
  layer             text not null check (layer in (
    'absent_failed_defences','individual_team_actions',
    'task_environmental_conditions','organisational_factors')),
  factor            text not null,
  evidence          text,
  ordinal           int  not null default 0,
  is_root           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_rca_icam_investigation
  on public.incident_rca_icam_factors(investigation_id, layer, ordinal);

drop trigger if exists trg_rca_icam_touch on public.incident_rca_icam_factors;
create trigger trg_rca_icam_touch
  before update on public.incident_rca_icam_factors
  for each row
  execute function public.touch_updated_at();

-- ── RLS for all four RCA tables (same predicate) ──────────────────────
alter table public.incident_rca_5whys           enable row level security;
alter table public.incident_rca_fishbone        enable row level security;
alter table public.incident_rca_taproot_factors enable row level security;
alter table public.incident_rca_icam_factors    enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'incident_rca_5whys', 'incident_rca_fishbone',
    'incident_rca_taproot_factors', 'incident_rca_icam_factors'
  ] loop
    execute format($q$
      drop policy if exists %I_tenant_scope on public.%I;
      create policy %I_tenant_scope on public.%I
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
    $q$, t, t, t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
