-- Migration 045: AI support assistant — conversations, messages, tickets
--
-- Persists chat sessions with the in-app support bot plus the human-handoff
-- tickets it opens. Schema mirrors lib/support/types.ts. RLS follows the
-- same pattern as migration 034 (bug_reports):
--   - users read & insert their own conversations + messages
--   - any authed user can insert a ticket (the API route enforces auth.getUser)
--   - reads on tickets are superadmin-only (email is the v1 notification path)

create table if not exists public.support_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- Active tenant when the conversation started. Nullable because the
  -- bot is mounted globally, including on routes a user might hit while
  -- between tenants (e.g. immediately after signup).
  tenant_id       uuid references public.tenants(id),
  -- Page the user opened the bot from (e.g. "/loto/north-line/MIX-04").
  -- Used for analytics + ticket triage.
  origin_path     text,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  resolved        boolean not null default false
);

create table if not exists public.support_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.support_conversations(id) on delete cascade,
  role              text not null check (role in ('user','assistant','system','tool')),
  content           text not null check (length(content) between 1 and 50000),
  -- Anthropic usage stats for assistant turns. Null for user/tool rows.
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  created_at         timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id),
  user_id         uuid not null references public.profiles(id),
  tenant_id       uuid references public.tenants(id),
  -- Snapshot of who reported, in case the profile/email changes later.
  user_email      text,
  user_name       text,
  -- Bot's structured summary. Length caps mirror bug_reports.
  subject         text not null check (length(trim(subject)) between 1 and 200),
  summary         text not null check (length(trim(summary)) between 1 and 4000),
  -- Why the bot escalated. The route validates against the same enum.
  reason          text not null
                    check (reason in ('user_requested','low_confidence','safety_critical')),
  -- Best-effort flag from the Resend send. Same semantics as bug_reports.
  emailed_ok      boolean,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_support_conversations_user_recent
  on public.support_conversations (user_id, last_message_at desc);

create index if not exists idx_support_messages_conversation
  on public.support_messages (conversation_id, created_at);

create index if not exists idx_support_tickets_open
  on public.support_tickets (created_at desc)
  where resolved_at is null;

alter table public.support_conversations enable row level security;
alter table public.support_messages      enable row level security;
alter table public.support_tickets       enable row level security;

-- Conversations: own-row read/write; superadmin read-all for triage.
drop policy if exists "support_conversations_owner_read"   on public.support_conversations;
drop policy if exists "support_conversations_owner_write"  on public.support_conversations;
drop policy if exists "support_conversations_superadmin_read" on public.support_conversations;

create policy "support_conversations_owner_read" on public.support_conversations
  for select to authenticated
  using (user_id = auth.uid());

create policy "support_conversations_owner_write" on public.support_conversations
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "support_conversations_superadmin_read" on public.support_conversations
  for select to authenticated
  using (public.is_superadmin());

-- Messages: same pattern, scoped via the parent conversation's owner.
drop policy if exists "support_messages_owner_read"        on public.support_messages;
drop policy if exists "support_messages_owner_insert"      on public.support_messages;
drop policy if exists "support_messages_superadmin_read"   on public.support_messages;

create policy "support_messages_owner_read" on public.support_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "support_messages_owner_insert" on public.support_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "support_messages_superadmin_read" on public.support_messages
  for select to authenticated
  using (public.is_superadmin());

-- Tickets: any authed user inserts (route additionally enforces auth.getUser);
-- only superadmin reads. Updates are superadmin-only too (resolve flow, Phase 3).
drop policy if exists "support_tickets_authenticated_insert" on public.support_tickets;
drop policy if exists "support_tickets_superadmin_read"      on public.support_tickets;
drop policy if exists "support_tickets_superadmin_update"    on public.support_tickets;

create policy "support_tickets_authenticated_insert" on public.support_tickets
  for insert to authenticated
  with check (auth.uid() is not null);

create policy "support_tickets_superadmin_read" on public.support_tickets
  for select to authenticated
  using (public.is_superadmin());

create policy "support_tickets_superadmin_update" on public.support_tickets
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

notify pgrst, 'reload schema';
