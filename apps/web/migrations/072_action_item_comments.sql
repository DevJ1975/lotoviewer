-- Migration 070: action-item comments + generic mentions table.
--
-- Phase 2 of the internal collaboration suite. Adds:
--   - action_item_comments — a threaded note/discussion attached to a
--     row in incident_actions (corrective/preventive actions). Soft
--     delete via deleted_at; edits stamp edited_at.
--   - mentions — a generic "user got @-mentioned somewhere" log. Used
--     by Phase 2 (action-item comments), Phase 3 (chat messages, DMs),
--     and Phase 4 (safety-board posts/replies). Powers a single
--     unread-mentions badge across the app.
--
-- All tables follow the migration 027/063 pattern: tenant_id NOT NULL,
-- per-row RLS scoped by active_tenant_id() and current_user_tenant_ids().
--
-- The mentions.source_type column is text (not enum) so a future phase
-- can add a value without an ALTER TYPE / migration. The CHECK
-- constraint enumerates allowed values today and can be relaxed later.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- action_item_comments — discussion thread on an incident_action
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.action_item_comments (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  incident_action_id  uuid not null references public.incident_actions(id) on delete cascade,
  author_user_id      uuid not null references auth.users(id),
  body                text not null check (length(trim(body)) between 1 and 10000),

  -- Denormalized list of @-mentioned user ids parsed from `body`. Lets
  -- the route fan out a Web Push without re-parsing the markdown on
  -- every dispatch and gives the mention-inbox query a cheap WHERE.
  body_mentions       uuid[] not null default '{}',

  edited_at           timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_action_comments_action
  on public.action_item_comments(incident_action_id, created_at)
  where deleted_at is null;

create index if not exists idx_action_comments_author
  on public.action_item_comments(author_user_id, created_at desc);

alter table public.action_item_comments enable row level security;

drop policy if exists action_item_comments_tenant_scope on public.action_item_comments;
create policy action_item_comments_tenant_scope on public.action_item_comments
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

-- ────────────────────────────────────────────────────────────────────────────
-- mentions — generic "user X was @-mentioned in surface Y" log
--
-- source_type / source_id together point at the surface the mention
-- happened on. We don't add an FK because source_id is polymorphic
-- across multiple tables; the writing route is responsible for
-- supplying valid pairs.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.mentions (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,

  source_type         text not null check (source_type in (
    'action_comment','channel_message','dm','board_thread','board_reply'
  )),
  source_id           uuid not null,

  -- The mentioner (FYI) and the mentionee (gets the badge).
  author_user_id      uuid not null references auth.users(id),
  mentioned_user_id   uuid not null references auth.users(id),

  -- Null until the mentioned user opens the surface. The badge query
  -- counts WHERE mentioned_user_id = $me AND read_at IS NULL.
  read_at             timestamptz,

  created_at          timestamptz not null default now()
);

-- Unread-mentions count for the header badge, scoped by tenant.
create index if not exists idx_mentions_unread
  on public.mentions(tenant_id, mentioned_user_id, read_at)
  where read_at is null;

-- "Show me my mention inbox for this tenant" — covers the common
-- ordering by most recent first.
create index if not exists idx_mentions_recipient_recent
  on public.mentions(tenant_id, mentioned_user_id, created_at desc);

-- Useful when a comment/message is deleted and we want to wipe its
-- pending mentions in one shot.
create index if not exists idx_mentions_source
  on public.mentions(source_type, source_id);

alter table public.mentions enable row level security;

drop policy if exists mentions_tenant_scope on public.mentions;
create policy mentions_tenant_scope on public.mentions
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
