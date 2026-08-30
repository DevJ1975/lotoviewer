-- Migration 237: Operator Console — persisted multi-turn conversations + messages.
--
-- Slice 2 of the Operator Console (Slice 1 shipped the agent registry +
-- sub-agent runner in apps/web/lib/ai/operator/). This adds storage so an
-- orchestrator conversation survives reloads and follow-up turns build on
-- prior ones.
--
-- Schema mirrors assistant_conversations / assistant_messages (migration 103)
-- for token accounting + RLS, with one difference: operator_messages has no
-- separate 'tool' role — a turn's multi-agent delegation log (which sub-agents
-- ran, their tool calls) lives in operator_messages.metadata instead. The
-- streaming route writes via supabaseAdmin() (RLS bypassed, like the assistant
-- route); these policies exist for triage and any future client-direct reads.
--
-- Idempotent (if not exists / drop policy if exists).

begin;

-- ── operator_conversations ────────────────────────────────────────────────
create table if not exists public.operator_conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- Active tenant when the conversation started. Required: the orchestrator
  -- grounds every turn in this tenant's modules + role — there is no useful
  -- tenantless mode.
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- First user-turn snippet, used as the title in the history list. The route
  -- trims to 80 chars on insert.
  title           text,
  -- Page the console was opened from (e.g. "/operator").
  origin_path     text,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.operator_messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.operator_conversations(id) on delete cascade,
  role               text not null check (role in ('user','assistant')),
  content            text not null check (length(content) between 1 and 50000),
  -- Multi-agent log for assistant turns, rendered as collapsible chips in the
  -- transcript. Shape:
  --   { delegations: [{ agentId, task, text, toolCalls: [{ name }], hitLoopCap }] }
  -- Nullable for plain user turns.
  metadata           jsonb,
  -- Anthropic usage for the orchestrator's own turn (sub-agent usage is logged
  -- per-surface in ai_invocations, not here). Null for user rows.
  input_tokens       int,
  output_tokens      int,
  cache_read_tokens  int,
  created_at         timestamptz not null default now()
);

create index if not exists idx_operator_conversations_user_recent
  on public.operator_conversations (user_id, last_message_at desc);

create index if not exists idx_operator_conversations_tenant_recent
  on public.operator_conversations (tenant_id, last_message_at desc);

create index if not exists idx_operator_messages_conversation
  on public.operator_messages (conversation_id, created_at);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.operator_conversations enable row level security;
alter table public.operator_messages      enable row level security;

-- Conversations: own-row read/write; tenant owner/admins + superadmins read-all
-- inside their tenant for triage.
drop policy if exists "operator_conversations_owner_read"      on public.operator_conversations;
drop policy if exists "operator_conversations_owner_write"     on public.operator_conversations;
drop policy if exists "operator_conversations_tenant_read"     on public.operator_conversations;
drop policy if exists "operator_conversations_superadmin_read" on public.operator_conversations;

create policy "operator_conversations_owner_read" on public.operator_conversations
  for select to authenticated
  using (user_id = auth.uid());

create policy "operator_conversations_owner_write" on public.operator_conversations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and tenant_id in (select public.current_user_tenant_ids())
  );

create policy "operator_conversations_tenant_read" on public.operator_conversations
  for select to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    and exists (
      select 1 from public.tenant_memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = operator_conversations.tenant_id
        and m.role in ('owner','admin')
    )
  );

create policy "operator_conversations_superadmin_read" on public.operator_conversations
  for select to authenticated
  using (public.is_superadmin());

-- Messages: scoped via the parent conversation's owner; tenant owner/admins +
-- superadmins read for triage.
drop policy if exists "operator_messages_owner_read"      on public.operator_messages;
drop policy if exists "operator_messages_owner_insert"    on public.operator_messages;
drop policy if exists "operator_messages_tenant_read"     on public.operator_messages;
drop policy if exists "operator_messages_superadmin_read" on public.operator_messages;

create policy "operator_messages_owner_read" on public.operator_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.operator_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "operator_messages_owner_insert" on public.operator_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.operator_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

create policy "operator_messages_tenant_read" on public.operator_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.operator_conversations c
      join public.tenant_memberships m
        on m.tenant_id = c.tenant_id and m.user_id = auth.uid()
      where c.id = conversation_id
        and m.role in ('owner','admin')
    )
  );

create policy "operator_messages_superadmin_read" on public.operator_messages
  for select to authenticated
  using (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
