-- Migration 103: Home-page AI assistant — conversations, messages, tasks.
--
-- PR1 of the AI redesign (see /docs/ai-redesign.md once it lands). The
-- assistant is a cross-module chatbot mounted globally via AssistantDock
-- and as a full page at /assistant. It differs from support-chat (045):
--   - support-chat is for "how do I use the app" + ticket escalation
--   - assistant is for "what does OSHA say about this equipment", tool
--     use against domain tables, and (PR3) alerting + automation
--
-- Schema mirrors support_messages for token accounting + cache_read.
-- assistant_tasks is the executor backlog used by PR3's cron — added
-- here so PR1 can already enqueue rows, even though the cron lands later.
--
-- One additive piggyback: ai_invocations.cache_read_tokens. The audit
-- in PR0 noted that support-chat tracks cache_read in support_messages
-- but the cross-surface dashboard undercounts because ai_invocations
-- lacked the column. Fixing it here closes the gap for every surface.

begin;

-- ── ai_invocations: cache_read_tokens column (additive) ──────────────────
alter table public.ai_invocations
  add column if not exists cache_read_tokens int;

-- ── assistant_conversations ──────────────────────────────────────────────
create table if not exists public.assistant_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- Active tenant when the conversation started. Required (unlike
  -- support-chat) because the assistant grounds answers in tenant
  -- modules + uploaded policies — there's no useful tenantless mode.
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- First user-turn snippet, used as the conversation title in the
  -- history sidebar. Updated only on insert; the route trims to 80 chars.
  title           text,
  -- Page the user opened the assistant from (e.g. "/equipment/MIX-04").
  origin_path     text,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.assistant_conversations(id) on delete cascade,
  role               text not null check (role in ('user','assistant','tool')),
  content            text not null check (length(content) between 1 and 50000),
  -- Tool calls / tool results are stored as JSON in metadata so the
  -- transcript UI can render them as collapsible chips. Nullable for
  -- plain user/assistant turns.
  metadata           jsonb,
  -- Anthropic usage stats for assistant turns. Null for user/tool rows.
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  created_at         timestamptz not null default now()
);

create index if not exists idx_assistant_conversations_user_recent
  on public.assistant_conversations (user_id, last_message_at desc);

create index if not exists idx_assistant_conversations_tenant_recent
  on public.assistant_conversations (tenant_id, last_message_at desc);

create index if not exists idx_assistant_messages_conversation
  on public.assistant_messages (conversation_id, created_at);

-- ── assistant_tasks (executor backlog; PR3 wires the cron) ───────────────
-- An assistant turn that schedules an action — "alert maintenance in 2h",
-- "email the Manager when chemical inventory drops below X" — writes a
-- row here. PR3's cron picks pending rows where run_at <= now().
create table if not exists public.assistant_tasks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         uuid not null references public.profiles(id),
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  -- Action kind. PR3 will define the executor switch; PR1 only writes
  -- the row when the model uses the schedule_followup tool.
  kind            text not null check (kind in ('alert','reminder','followup')),
  payload         jsonb not null,
  run_at          timestamptz not null,
  status          text not null default 'pending'
                    check (status in ('pending','running','done','failed','cancelled')),
  attempts        int  not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_assistant_tasks_pending
  on public.assistant_tasks (run_at)
  where status = 'pending';

create index if not exists idx_assistant_tasks_tenant
  on public.assistant_tasks (tenant_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages      enable row level security;
alter table public.assistant_tasks         enable row level security;

-- Conversations: own-row read/write; tenant admins + superadmins read-all
-- inside their tenant for triage.
drop policy if exists "assistant_conversations_owner_read"      on public.assistant_conversations;
drop policy if exists "assistant_conversations_owner_write"     on public.assistant_conversations;
drop policy if exists "assistant_conversations_tenant_read"     on public.assistant_conversations;
drop policy if exists "assistant_conversations_superadmin_read" on public.assistant_conversations;

create policy "assistant_conversations_owner_read" on public.assistant_conversations
  for select to authenticated
  using (user_id = auth.uid());

create policy "assistant_conversations_owner_write" on public.assistant_conversations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and tenant_id in (select public.current_user_tenant_ids())
  );

create policy "assistant_conversations_tenant_read" on public.assistant_conversations
  for select to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    and exists (
      select 1 from public.tenant_memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = assistant_conversations.tenant_id
        and m.role in ('owner','admin')
    )
  );

create policy "assistant_conversations_superadmin_read" on public.assistant_conversations
  for select to authenticated
  using (public.is_superadmin());

-- Messages: scoped via the parent conversation's owner.
drop policy if exists "assistant_messages_owner_read"        on public.assistant_messages;
drop policy if exists "assistant_messages_owner_insert"      on public.assistant_messages;
drop policy if exists "assistant_messages_tenant_read"       on public.assistant_messages;
drop policy if exists "assistant_messages_superadmin_read"   on public.assistant_messages;

create policy "assistant_messages_owner_read" on public.assistant_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "assistant_messages_owner_insert" on public.assistant_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.assistant_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "assistant_messages_tenant_read" on public.assistant_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.assistant_conversations c
      join public.tenant_memberships m
        on m.tenant_id = c.tenant_id and m.user_id = auth.uid()
      where c.id = conversation_id
        and m.role in ('owner','admin')
    )
  );

create policy "assistant_messages_superadmin_read" on public.assistant_messages
  for select to authenticated
  using (public.is_superadmin());

-- Tasks: tenant-scoped read for members, insert by the owner only,
-- updates only via service role (cron). Rejecting non-service writes
-- makes the cron the single source of truth for status transitions.
drop policy if exists "assistant_tasks_tenant_read"    on public.assistant_tasks;
drop policy if exists "assistant_tasks_owner_insert"   on public.assistant_tasks;
drop policy if exists "assistant_tasks_superadmin_read" on public.assistant_tasks;

create policy "assistant_tasks_tenant_read" on public.assistant_tasks
  for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

create policy "assistant_tasks_owner_insert" on public.assistant_tasks
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and tenant_id in (select public.current_user_tenant_ids())
  );

create policy "assistant_tasks_superadmin_read" on public.assistant_tasks
  for select to authenticated
  using (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
