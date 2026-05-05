-- Migration 047: ai_invocations log + rate limiting backbone.
--
-- Phase 1.2 of the AI configuration audit. Three of the four AI
-- routes (generate-loto-steps, generate-confined-space-hazards,
-- validate-photo) gained an auth gate in the prior commit; this
-- migration adds the durable per-user rate-limit substrate.
--
-- The same table powers Phase 3 observability: every Anthropic
-- call gets a row, so token attribution per tenant + per surface
-- is a single GROUP BY away. Storing model + status + tokens
-- means we can answer "which tenant burned the most $ this month
-- on confined-space hazard generation?" without scraping
-- Anthropic Console.
--
-- Rows are append-only by convention but NOT enforced via REVOKE
-- (this is metric data, not audit-log data). RLS scopes per
-- tenant + per user.

begin;

create table if not exists public.ai_invocations (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id),
  tenant_id       uuid references public.tenants(id) on delete cascade,
  -- Logical name of the AI surface that fired the call. One of:
  --   support-chat
  --   generate-loto-steps
  --   generate-confined-space-hazards
  --   validate-photo
  -- Free-form text so future surfaces don't need a migration.
  surface         text not null,
  -- Anthropic model id used for the call. Captured in case a
  -- future surface picks a different family.
  model           text not null,
  -- success / rate_limited / error. rate_limited rows are recorded
  -- BEFORE the Anthropic call so the rate-limit logic can count
  -- them against the user's quota.
  status          text not null check (status in ('success', 'rate_limited', 'error')),
  -- Anthropic usage block: stored when status='success'.
  input_tokens   int,
  output_tokens  int,
  -- Free-form context for debugging; e.g. equipment_id for LOTO,
  -- space_id for CS, conversation_id for chat. Not indexed.
  context         text,
  occurred_at     timestamptz not null default now()
);

-- Hot path indexes for the rate-limit count query.
create index if not exists idx_ai_invocations_user_recent
  on public.ai_invocations(user_id, surface, occurred_at desc);

create index if not exists idx_ai_invocations_tenant_recent
  on public.ai_invocations(tenant_id, occurred_at desc)
  where tenant_id is not null;

-- ──────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ──────────────────────────────────────────────────────────────────────────

alter table public.ai_invocations enable row level security;

-- Users see only their own invocations. Admins of a tenant see
-- every invocation tagged to that tenant. Superadmins see all.
drop policy if exists ai_invocations_select on public.ai_invocations;
create policy ai_invocations_select on public.ai_invocations
  for select to authenticated
  using (
    user_id = auth.uid()
    or (
      tenant_id is not null
      and tenant_id in (select public.current_user_tenant_ids())
    )
    or public.is_superadmin()
  );

-- Anyone authenticated can insert their own rows. The route handlers
-- write with the user's JWT so user_id = auth.uid() is enforceable.
drop policy if exists ai_invocations_insert on public.ai_invocations;
create policy ai_invocations_insert on public.ai_invocations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      tenant_id is null
      or tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

-- No update / delete policies — append-only by RLS contract.
-- (Service role bypasses RLS; if a future cleanup job needs to
-- prune old rows it runs as service role. No application path
-- mutates this table.)

notify pgrst, 'reload schema';

commit;
