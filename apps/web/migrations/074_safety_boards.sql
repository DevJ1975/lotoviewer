-- Migration 072: safety discussion boards (Phase 4 — threaded forums).
--
-- Final phase of the internal collaboration suite. Adds:
--   - safety_boards         — one row per discussion board (e.g.
--                             "General Safety", "Near-Miss Discussion")
--   - safety_board_threads  — top-level posts on a board, with title +
--                             pinned + locked admin flags
--   - safety_board_replies  — flat replies under a thread (optional
--                             parent_reply_id for one-level nesting,
--                             rendered as a quote/indent)
--   - safety_board_reactions — emoji reactions, polymorphic via
--                             (target_type, target_id) keyed (target,
--                             user, emoji)
--
-- All tables RLS-scoped by active_tenant_id() + current_user_tenant_ids()
-- following the migration 027/063/070/071 pattern. Admin-only actions
-- (pin, lock, archive, board create) are enforced at the API layer.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- safety_boards
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_boards (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 80),
  slug            text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  description     text,
  created_by      uuid not null references auth.users(id),
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),

  unique (tenant_id, slug)
);

create index if not exists idx_safety_boards_tenant
  on public.safety_boards(tenant_id, archived_at, created_at);

-- ────────────────────────────────────────────────────────────────────────────
-- safety_board_threads
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_threads (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  board_id        uuid not null references public.safety_boards(id) on delete cascade,
  author_user_id  uuid not null references auth.users(id),
  title           text not null check (length(trim(title)) between 1 and 200),
  body            text not null check (length(body) between 1 and 20000),
  body_mentions   uuid[] not null default '{}',
  pinned          boolean not null default false,
  locked          boolean not null default false,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  -- Bumped whenever a non-deleted reply lands; drives "most recently
  -- active first" ordering on the thread list.
  last_reply_at   timestamptz not null default now()
);

-- Pinned-first, then most-recent-activity. Partial because
-- archived/deleted threads disappear from the listing.
create index if not exists idx_safety_threads_board_activity
  on public.safety_board_threads(board_id, pinned desc, last_reply_at desc)
  where deleted_at is null;

create index if not exists idx_safety_threads_author_recent
  on public.safety_board_threads(author_user_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- safety_board_replies
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_replies (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  thread_id       uuid not null references public.safety_board_threads(id) on delete cascade,
  author_user_id  uuid not null references auth.users(id),
  body            text not null check (length(body) between 1 and 20000),
  body_mentions   uuid[] not null default '{}',
  -- Optional self-FK for one-level nested quote replies. We don't
  -- recurse — the UI flattens parent_reply_id into a "in reply to"
  -- preview at the top of the reply.
  parent_reply_id uuid references public.safety_board_replies(id) on delete set null,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_safety_replies_thread
  on public.safety_board_replies(thread_id, created_at)
  where deleted_at is null;

-- Touch the parent thread's last_reply_at when a fresh reply arrives.
create or replace function public.bump_safety_thread_activity()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is null then
    update public.safety_board_threads
      set last_reply_at = new.created_at
      where id = new.thread_id
        and last_reply_at < new.created_at;
  end if;
  return new;
end
$$;

drop trigger if exists trg_safety_replies_bump on public.safety_board_replies;
create trigger trg_safety_replies_bump
  after insert on public.safety_board_replies
  for each row execute function public.bump_safety_thread_activity();

-- ────────────────────────────────────────────────────────────────────────────
-- safety_board_reactions — polymorphic over thread/reply
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_reactions (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  target_type  text not null check (target_type in ('thread','reply')),
  target_id    uuid not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  emoji        text not null check (length(emoji) between 1 and 32),
  created_at   timestamptz not null default now(),
  primary key (target_type, target_id, user_id, emoji)
);

create index if not exists idx_safety_reactions_target
  on public.safety_board_reactions(target_type, target_id);

-- ────────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────────
alter table public.safety_boards            enable row level security;
alter table public.safety_board_threads     enable row level security;
alter table public.safety_board_replies     enable row level security;
alter table public.safety_board_reactions   enable row level security;

drop policy if exists safety_boards_tenant_scope          on public.safety_boards;
drop policy if exists safety_board_threads_tenant_scope   on public.safety_board_threads;
drop policy if exists safety_board_replies_tenant_scope   on public.safety_board_replies;
drop policy if exists safety_board_reactions_tenant_scope on public.safety_board_reactions;

create policy safety_boards_tenant_scope on public.safety_boards
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy safety_board_threads_tenant_scope on public.safety_board_threads
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy safety_board_replies_tenant_scope on public.safety_board_replies
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy safety_board_reactions_tenant_scope on public.safety_board_reactions
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
