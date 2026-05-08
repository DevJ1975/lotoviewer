-- Migration 071: internal chat (channels + DMs + reactions + attachments).
--
-- Phase 3 of the internal collaboration suite. Adds:
--   - chat_channels         — one row per group channel OR DM. DMs use
--                             kind='dm' with a NULL name.
--   - chat_channel_members  — membership + per-user last-read pointer
--                             (drives unread badges).
--   - chat_messages         — body, optional parent for threading,
--                             denormalized body_mentions for cheap
--                             notification fanout.
--   - chat_message_attachments — pointers to objects in the
--                             chat-attachments storage bucket.
--   - chat_message_reactions — emoji reactions, one row per
--                             (message, user, emoji) tuple.
--   - chat-attachments storage bucket (private; read/write only when
--     the path's first segment is a tenant the caller is a member
--     of). Per-channel access is enforced at the API layer because
--     storage RLS can't see chat_channel_members.
--
-- All tables RLS-scoped by active_tenant_id() + current_user_tenant_ids()
-- following the migration 027/063/070 pattern.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- chat_channels
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_channels (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  kind            text not null check (kind in ('channel','dm')),
  -- Channels have a human-readable name; DMs are nameless (the UI
  -- shows the other participant's display name).
  name            text,
  slug            text,
  description     text,
  created_by      uuid not null references auth.users(id),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  -- Bumped whenever a new (non-deleted) message is posted. Lets the
  -- channel list sort by activity without scanning chat_messages.
  last_activity_at timestamptz not null default now(),

  -- Channels need a non-empty name; DMs do not. Slugs unique per tenant.
  check ((kind = 'dm' and name is null) or (kind = 'channel' and length(trim(name)) between 1 and 80)),
  check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  unique (tenant_id, slug)
);

create index if not exists idx_chat_channels_activity
  on public.chat_channels(tenant_id, last_activity_at desc)
  where archived_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- chat_channel_members
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_channel_members (
  channel_id            uuid not null references public.chat_channels(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  role                  text not null default 'member' check (role in ('member','admin')),
  -- Pointer to the last message id the user has read in this channel.
  -- Unread count = messages with id > last_read_message_id.
  last_read_message_id  uuid,
  muted_at              timestamptz,
  joined_at             timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists idx_chat_channel_members_user
  on public.chat_channel_members(user_id, tenant_id);

-- ────────────────────────────────────────────────────────────────────────────
-- chat_messages
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id                  uuid not null primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  channel_id          uuid not null references public.chat_channels(id) on delete cascade,
  author_user_id      uuid not null references auth.users(id),
  body                text not null check (length(body) between 0 and 10000),
  body_mentions       uuid[] not null default '{}',
  -- Optional self-FK for threaded replies. Threads are flat (parent
  -- + replies, not deeply nested) — Slack-style.
  parent_message_id   uuid references public.chat_messages(id) on delete set null,
  edited_at           timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_chat_messages_channel_recent
  on public.chat_messages(channel_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_chat_messages_channel_id_seq
  on public.chat_messages(channel_id, id)
  where deleted_at is null;

create index if not exists idx_chat_messages_thread
  on public.chat_messages(parent_message_id, created_at)
  where parent_message_id is not null and deleted_at is null;

-- Bump the channel's last_activity_at when a new live message arrives.
create or replace function public.bump_chat_channel_activity()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is null then
    update public.chat_channels
      set last_activity_at = new.created_at
      where id = new.channel_id
        and last_activity_at < new.created_at;
  end if;
  return new;
end
$$;

drop trigger if exists trg_chat_messages_bump on public.chat_messages;
create trigger trg_chat_messages_bump
  after insert on public.chat_messages
  for each row execute function public.bump_chat_channel_activity();

-- ────────────────────────────────────────────────────────────────────────────
-- chat_message_attachments
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_message_attachments (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- Nullable so the upload route can create the row before the
  -- message itself exists. The POST /messages handler updates
  -- message_id to the freshly-inserted message. Orphaned rows
  -- (uploaded but never sent) accumulate slowly; a future cleanup
  -- job can prune rows where message_id is null and created_at is
  -- older than ~24h.
  message_id      uuid references public.chat_messages(id) on delete cascade,
  -- The user who uploaded the file. Used to gate "claim later" so
  -- another user can't attach someone else's pending upload to
  -- their own message.
  uploaded_by     uuid not null references auth.users(id),
  storage_path    text not null,
  mime_type       text not null,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 25_000_000),
  width           int,
  height          int,
  filename        text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_chat_attachments_message
  on public.chat_message_attachments(message_id)
  where message_id is not null;

create index if not exists idx_chat_attachments_orphans
  on public.chat_message_attachments(uploaded_by, created_at)
  where message_id is null;

-- ────────────────────────────────────────────────────────────────────────────
-- chat_message_reactions
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.chat_message_reactions (
  message_id   uuid not null references public.chat_messages(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  emoji        text not null check (length(emoji) between 1 and 32),
  created_at   timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists idx_chat_reactions_message
  on public.chat_message_reactions(message_id);

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — every chat table is tenant-scoped. Channel-membership scoping
-- happens at the API layer (the route filters by chat_channel_members
-- before hitting these tables). RLS still hard-blocks cross-tenant
-- access at the DB layer.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.chat_channels             enable row level security;
alter table public.chat_channel_members      enable row level security;
alter table public.chat_messages             enable row level security;
alter table public.chat_message_attachments  enable row level security;
alter table public.chat_message_reactions    enable row level security;

drop policy if exists chat_channels_tenant_scope             on public.chat_channels;
drop policy if exists chat_channel_members_tenant_scope      on public.chat_channel_members;
drop policy if exists chat_messages_tenant_scope             on public.chat_messages;
drop policy if exists chat_message_attachments_tenant_scope  on public.chat_message_attachments;
drop policy if exists chat_message_reactions_tenant_scope    on public.chat_message_reactions;

create policy chat_channels_tenant_scope on public.chat_channels
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy chat_channel_members_tenant_scope on public.chat_channel_members
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy chat_messages_tenant_scope on public.chat_messages
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy chat_message_attachments_tenant_scope on public.chat_message_attachments
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy chat_message_reactions_tenant_scope on public.chat_message_reactions
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
-- chat-attachments storage bucket
--
-- PRIVATE bucket. The route layer issues short-lived signed URLs after
-- verifying the caller is a member of the channel. Storage RLS scopes
-- read/write to objects whose first path segment is a tenant the
-- caller is a member of — second-line defense in case the route layer
-- has a bug.
--
-- Path convention: chat-attachments/{tenant_id}/{channel_id}/{message_id}/{filename}
-- ────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists chat_attachments_tenant_scope on storage.objects;
create policy chat_attachments_tenant_scope on storage.objects
  for all to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (
      (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    bucket_id = 'chat-attachments'
    and (
      (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
