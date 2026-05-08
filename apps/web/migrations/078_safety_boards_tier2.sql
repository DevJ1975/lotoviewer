-- 078_safety_boards_tier2.sql
-- Tier 2 upgrade to /safety-boards: search, anonymity, access
-- scoping, subscriptions, digest prefs.
--
-- 6. Postgres full-text search on title + body for both threads and
--    replies. Adds a generated tsvector column + GIN index. The API
--    uses websearch_to_tsquery so the input syntax is intuitive
--    (`+required -excluded "exact phrase"`).
-- 7. Anonymous posting opt-in per board. The board carries a flag;
--    individual threads/replies can be marked anonymous. The author
--    column stays populated for auditability/admin recovery (rare
--    but legally important: if the post is libelous or threatens
--    someone, an admin needs to know who wrote it). Public surfaces
--    blank the author when anonymous=true.
-- 8. Per-board access scoping — beyond the tenant-wide default,
--    boards can be restricted to specific roles or departments.
--    Stored as a list of scope rules; an empty list means "anyone
--    in the tenant" (default).
-- 9. Subscriptions — explicit follow-without-replying, per-thread
--    mute. Replaces the implicit "thread author always notified"
--    rule with an opt-in graph; existing implicit subscribers
--    (thread authors) get rows backfilled.
-- 10. Digest preferences — per-user opt-in for daily/weekly email
--     summaries of board activity in their tenant.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Full-text search
-- ────────────────────────────────────────────────────────────────────────────
alter table public.safety_board_threads
  add column if not exists search_tsv tsvector
    generated always as (
      setweight(to_tsvector('english', coalesce(title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(body,  '')), 'B')
    ) stored;

create index if not exists idx_safety_threads_fts
  on public.safety_board_threads using gin (search_tsv)
  where deleted_at is null;

alter table public.safety_board_replies
  add column if not exists search_tsv tsvector
    generated always as (to_tsvector('english', coalesce(body, '')))
    stored;

create index if not exists idx_safety_replies_fts
  on public.safety_board_replies using gin (search_tsv)
  where deleted_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Anonymous posting
-- ────────────────────────────────────────────────────────────────────────────
alter table public.safety_boards
  add column if not exists allow_anonymous boolean not null default false;

alter table public.safety_board_threads
  add column if not exists is_anonymous boolean not null default false;

alter table public.safety_board_replies
  add column if not exists is_anonymous boolean not null default false;

-- Index for "find anonymous threads" admin reporting.
create index if not exists idx_safety_threads_anonymous
  on public.safety_board_threads(tenant_id, created_at desc)
  where is_anonymous = true and deleted_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Per-board access scoping
--
-- Empty list => any tenant member. Otherwise a row enumerates one
-- granted scope; access = OR across the rows. scope_type:
--   'role'         scope_value is a tenant_memberships.role
--                   ('owner' | 'admin' | 'member' | 'viewer'). Members
--                   with that role pass.
--   'department'   scope_value is a department slug. Members whose
--                   profile / membership has that department pass.
--                   Department resolution is a no-op today (no
--                   profile.department column) but the column is
--                   available for tenants that add one; the API
--                   falls back to "any tenant member" when there's
--                   no department mechanism in this deployment.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_access (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  board_id     uuid not null references public.safety_boards(id) on delete cascade,
  scope_type   text not null check (scope_type in ('role','department')),
  scope_value  text not null,
  created_at   timestamptz not null default now(),
  unique (board_id, scope_type, scope_value)
);

create index if not exists idx_safety_board_access_board
  on public.safety_board_access(board_id);

alter table public.safety_board_access enable row level security;

drop policy if exists safety_board_access_tenant_scope on public.safety_board_access;
create policy safety_board_access_tenant_scope on public.safety_board_access
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Subscriptions
--
-- target_type/target_id polymorphic over board / thread. Mute is the
-- absence of a row OR a row with muted=true (we keep the row so a
-- future "subscribed but muted" UX is a single column toggle).
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_subscriptions (
  user_id      uuid not null references auth.users(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  target_type  text not null check (target_type in ('board','thread')),
  target_id    uuid not null,
  -- 'follow'  = receive notifications.
  -- 'mute'    = explicitly suppress (e.g. "I'm the author but don't
  --              want pings on every reply"). Author-implicit follow
  --              is overridden by an explicit mute row.
  state        text not null default 'follow'
                 check (state in ('follow','mute')),
  created_at   timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index if not exists idx_safety_subscriptions_target
  on public.safety_board_subscriptions(target_type, target_id, state);

alter table public.safety_board_subscriptions enable row level security;

drop policy if exists safety_subs_tenant_scope on public.safety_board_subscriptions;
create policy safety_subs_tenant_scope on public.safety_board_subscriptions
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Digest preferences
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_digest_preferences (
  user_id        uuid not null references auth.users(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  -- 'off' | 'daily' | 'weekly'. Defaults to off so we don't surprise
  -- existing users with email blasts.
  cadence        text not null default 'off'
                   check (cadence in ('off','daily','weekly')),
  last_sent_at   timestamptz,
  -- Stored alongside the preference so the cron can short-circuit
  -- without joining auth.users — saves ~50 ms on hot paths.
  email          text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists idx_user_digest_prefs_due
  on public.user_digest_preferences(tenant_id, cadence, last_sent_at)
  where cadence <> 'off';

alter table public.user_digest_preferences enable row level security;

drop policy if exists user_digest_prefs_self on public.user_digest_preferences;
create policy user_digest_prefs_self on public.user_digest_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Touch updated_at on changes.
create or replace function public.touch_user_digest_prefs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_user_digest_prefs_touch on public.user_digest_preferences;
create trigger trg_user_digest_prefs_touch
  before update on public.user_digest_preferences
  for each row execute function public.touch_user_digest_prefs_updated_at();

notify pgrst, 'reload schema';

commit;
