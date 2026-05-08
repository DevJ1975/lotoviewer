-- 079_safety_boards_tier3.sql
-- Tier 3 upgrade to /safety-boards: quick-post templates and a
-- trending view. Cross-reference autolinking and PDF export are
-- pure code (no schema), so they don't appear here.
--
-- 11. Quick-post templates — admin-defined per-board templates that
--     pre-fill the new-thread composer. Each template is a kind +
--     a default body skeleton; structured fields are typed via the
--     existing safety_board_threads.metadata jsonb so a template
--     can declare {"location": "string", "severity": "enum:low|med|high"}
--     and the composer renders the right widgets.
-- 13. Trending — a tenant-scoped view that surfaces "most-active in
--     the past 7 days." Surfaced on /safety-boards as a small
--     widget at the top of the index. The view is plain (not
--     materialized) so it stays in sync without refresh churn;
--     volume per tenant is small enough that the query is cheap.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. safety_board_thread_templates
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.safety_board_thread_templates (
  id              uuid not null primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  board_id        uuid not null references public.safety_boards(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 80),
  description     text,
  kind            text not null check (kind in (
    'hazard_report','near_miss_reflection','lesson_learned',
    'alert','question','discussion'
  )),
  -- Pre-filled title (with optional [placeholder] tokens the
  -- composer leaves untouched until the user types).
  default_title   text,
  -- Pre-filled body skeleton, e.g. "**What did you observe?**\n\n
  -- **Where?**\n\n**Severity?**".
  default_body    text,
  -- Structured-field schema for the metadata jsonb. Shape:
  --   [
  --     { "key": "severity", "label": "Severity", "type": "enum",
  --       "options": ["low","medium","high"], "required": true },
  --     { "key": "location", "label": "Location", "type": "string",
  --       "required": false }
  --   ]
  -- The composer renders one widget per entry. Typing the top-level
  -- as plain jsonb keeps schema migration light; per-tenant
  -- evolution is a config change, not a DB change.
  fields_schema   jsonb not null default '[]'::jsonb,
  -- Optional sort order on the picker. Lower numbers first.
  sort_order      int not null default 100,
  archived_at     timestamptz,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists idx_safety_thread_templates_board
  on public.safety_board_thread_templates(board_id, sort_order, created_at)
  where archived_at is null;

alter table public.safety_board_thread_templates enable row level security;

drop policy if exists safety_board_thread_templates_tenant_scope on public.safety_board_thread_templates;
create policy safety_board_thread_templates_tenant_scope on public.safety_board_thread_templates
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
-- 13. Trending view — tenant-scoped most-active threads in the
-- past 7 days. Activity score = reply count + reaction count + a
-- small recency boost. Plain view (not materialized) — board volume
-- per tenant is small.
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.safety_board_trending as
with windowed_replies as (
  select thread_id, tenant_id, count(*) as reply_count_7d
  from public.safety_board_replies
  where deleted_at is null
    and created_at > now() - interval '7 days'
  group by thread_id, tenant_id
),
windowed_reactions as (
  -- Thread-level reactions (target_type='thread').
  select target_id as thread_id, tenant_id, count(*) as reaction_count_7d
  from public.safety_board_reactions
  where target_type = 'thread'
    and created_at > now() - interval '7 days'
  group by target_id, tenant_id
)
select
  t.tenant_id,
  t.id              as thread_id,
  t.board_id,
  t.kind,
  t.title,
  t.pinned,
  t.locked,
  t.is_anonymous,
  t.acknowledgement_required,
  t.last_reply_at,
  t.created_at,
  coalesce(wr.reply_count_7d, 0) as reply_count_7d,
  coalesce(rxn.reaction_count_7d, 0) as reaction_count_7d,
  -- Activity score: replies are heavier than reactions, with a
  -- small bump for very recent threads so brand-new posts surface.
  (
    coalesce(wr.reply_count_7d, 0) * 3
    + coalesce(rxn.reaction_count_7d, 0)
    + case when t.created_at > now() - interval '24 hours' then 2 else 0 end
  ) as score
from public.safety_board_threads t
left join windowed_replies   wr  on wr.thread_id = t.id
left join windowed_reactions rxn on rxn.thread_id = t.id
where t.deleted_at is null
  and (
    t.created_at > now() - interval '7 days'
    or wr.reply_count_7d is not null
    or rxn.reaction_count_7d is not null
  );

-- Views inherit RLS from underlying tables, so tenant-scoping is
-- enforced automatically.

notify pgrst, 'reload schema';

commit;
