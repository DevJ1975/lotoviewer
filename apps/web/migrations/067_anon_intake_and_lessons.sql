-- Migration 067: Phase 6 advanced extras.
--
-- Two unrelated additions bundled because each is small:
--
-- 1. incident_anon_intake_tokens — per-location QR-code tokens for
--    anonymous incident reporting. Each token represents a posted
--    physical sign ("scan to report") at a particular location. The
--    public POST endpoint validates the token + the tenant context
--    flows from there; no JWT required. OSHA 1904.35(b)(1)(i)
--    explicitly requires "a reasonable procedure for employees to
--    report work-related injuries and illnesses promptly," and the
--    same regulation forbids retaliation — anonymous reporting is
--    the strongest implementation.
--
-- 2. incident_investigations gets two new columns: `publish_lesson`
--    (boolean) and `lesson_summary` (text). When the lead
--    investigator publishes a lesson, the lessons-learned library
--    surfaces it tenant-wide so other teams can learn from the
--    incident. Privacy-case incidents stay redacted in the library.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. incident_anon_intake_tokens — per-location QR tokens.
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.incident_anon_intake_tokens (
  id                   uuid not null primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,

  -- Human-readable label for the printed sign. Examples:
  --   "Loading dock B"
  --   "Plant 1 — main entrance"
  --   "Mobile crew — truck 14"
  label                text not null,

  -- The token a worker hands us via the QR scan. Hex, 64 chars.
  token                text not null unique,

  -- Optional cap on how often a single token can produce reports
  -- per hour (rough rate-limit). NULL = no cap. Phase 6 default is
  -- NULL; abuse mitigation can dial this in later.
  rate_limit_per_hour  int,

  -- Soft enable flag — disabling the token without deleting it lets
  -- a tenant retire a posted sign without orphaning historical
  -- anonymous reports that referenced it.
  enabled              boolean not null default true,

  -- Anti-spam: track usage so the rate-limit check has data and the
  -- admin can see "how many reports came from this sign last
  -- month." Updated by the public submit endpoint.
  total_reports        int  not null default 0,
  last_used_at         timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  -- Tracks the admin who last patched the row (typically a
  -- relabel or an enable/disable).
  updated_by           uuid references auth.users(id)
);

create index if not exists idx_anon_tokens_tenant
  on public.incident_anon_intake_tokens(tenant_id) where enabled = true;
create index if not exists idx_anon_tokens_lookup
  on public.incident_anon_intake_tokens(token) where enabled = true;

drop trigger if exists trg_anon_tokens_touch on public.incident_anon_intake_tokens;
create trigger trg_anon_tokens_touch
  before update on public.incident_anon_intake_tokens
  for each row
  execute function public.touch_updated_at();

alter table public.incident_anon_intake_tokens enable row level security;

drop policy if exists anon_tokens_tenant_scope on public.incident_anon_intake_tokens;
create policy anon_tokens_tenant_scope on public.incident_anon_intake_tokens
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

-- The public POST endpoint at /api/anonymous-report uses
-- supabaseAdmin (RLS-bypassing service role) by design — the
-- worker has no JWT. Security rests on the token + the rate-limit
-- check. We deliberately don't add an anon RLS policy.

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Allow incidents.reported_by to be NULL for anonymous intake.
-- ──────────────────────────────────────────────────────────────────────────
--
-- Phase 1's schema set incidents.reported_by NOT NULL (we always
-- knew who filed). Anonymous QR reports legitimately don't have an
-- auth user to attribute to. Drop the NOT NULL; the
-- is_anonymous boolean is the source of truth for "anonymous?".

alter table public.incidents
  alter column reported_by drop not null;

-- Add a CHECK that ties is_anonymous = true ↔ reported_by IS NULL.
-- Authenticated reports must still carry their user id.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'incidents_anon_or_user_only'
  ) then
    alter table public.incidents
      add constraint incidents_anon_or_user_only
      check ((is_anonymous = true and reported_by is null)
          or (is_anonymous = false and reported_by is not null));
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Lessons-learned columns on incident_investigations.
-- ──────────────────────────────────────────────────────────────────────────

alter table public.incident_investigations
  add column if not exists publish_lesson boolean not null default false;
alter table public.incident_investigations
  add column if not exists lesson_summary text;
alter table public.incident_investigations
  add column if not exists lesson_published_at timestamptz;
alter table public.incident_investigations
  add column if not exists lesson_published_by uuid references auth.users(id);

-- Index for the lessons library list.
create index if not exists idx_investigations_published_lesson
  on public.incident_investigations(tenant_id, lesson_published_at desc)
  where publish_lesson = true and lesson_published_at is not null;

notify pgrst, 'reload schema';

commit;
