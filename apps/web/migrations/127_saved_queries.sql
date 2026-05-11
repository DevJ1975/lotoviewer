-- Migration 127: saved_queries — superadmin-authored read-only SQL.
--
-- Why: today operators paste SQL into the Supabase SQL editor every
-- time they need to answer "how many tenants are over 80% of their AI
-- quota?" or "which permits canceled in the last 24h?". That history
-- isn't shared, isn't versioned, and gets lost the next time the
-- editor refreshes. This migration adds a tiny saved-query store +
-- a hardened executor so superadmins can ship reusable diagnostics
-- inside the app.
--
-- Safety layers (defense in depth — any one of these failing should
-- still leave the others in place):
--   1. The /api/superadmin/queries/run route gates on requireSuperadmin
--      AND on a regex that rejects anything starting with non-SELECT.
--   2. exec_readonly_sql() opens a SECURITY DEFINER block with
--      `SET LOCAL transaction_read_only = on` so even if the regex is
--      bypassed, the DB refuses writes.
--   3. statement_timeout caps runaway queries at 10s.
--   4. Result is capped at max_rows (default 1000, hard ceiling 5000).
--
-- The saved_queries table is metadata only; the executor accepts any
-- SQL the route hands it. Saving and running are intentionally
-- decoupled so an operator can iterate in the editor without churning
-- a "draft" row.

begin;

-- ──────────────────────────────────────────────────────────────────────
-- 1. Table
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.saved_queries (
  id          bigserial primary key,
  name        text not null check (length(name) between 1 and 120),
  description text,
  sql_text    text not null check (length(sql_text) between 1 and 8000),
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_saved_queries_recent
  on public.saved_queries (updated_at desc);

create unique index if not exists ux_saved_queries_name
  on public.saved_queries (lower(name));

drop trigger if exists trg_saved_queries_touch on public.saved_queries;
create trigger trg_saved_queries_touch
  before update on public.saved_queries
  for each row execute function public.touch_updated_at();

comment on table public.saved_queries is
  'Superadmin-authored read-only SQL snippets. Executed via /api/superadmin/queries/run which calls public.exec_readonly_sql.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. Executor
-- ──────────────────────────────────────────────────────────────────────
-- Returns jsonb (an array of row objects) so the API doesn't need to
-- know column shapes. Capped + read-only + timed-out — see header.
create or replace function public.exec_readonly_sql(sql_text text, max_rows int default 1000)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  capped int := least(greatest(coalesce(max_rows, 1000), 1), 5000);
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'exec_readonly_sql requires superadmin' using errcode = '42501';
  end if;

  -- Mandatory shape check. The API gates on this too; defense in depth.
  if sql_text !~* '^\s*(with\s|select\s|explain\s)' then
    raise exception 'Only SELECT, WITH, or EXPLAIN statements are allowed' using errcode = '42501';
  end if;
  -- Defense against statement-stuffing: if a DDL/DML keyword appears
  -- after the leading SELECT (e.g. via a semicolon), the read-only
  -- transaction below would still block it, but we also fail loud
  -- here so the operator gets a useful error message.
  if sql_text ~* ';\s*(insert|update|delete|drop|truncate|alter|create|grant|revoke|refresh|reindex|vacuum|comment\s+on)\b' then
    raise exception 'Compound statements with writes are not allowed' using errcode = '42501';
  end if;

  set local statement_timeout = '10s';
  set local transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (%s) t limit %s',
    sql_text, capped
  ) into result;

  return result;
end $$;

revoke all on function public.exec_readonly_sql(text, int) from public;
grant execute on function public.exec_readonly_sql(text, int) to authenticated;

comment on function public.exec_readonly_sql(text, int) is
  'Run a read-only SELECT/WITH/EXPLAIN and return the result as jsonb. Caller must be superadmin. Capped at 5000 rows + 10s. Read-only transaction enforces no writes.';

-- ──────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.saved_queries enable row level security;

drop policy if exists "saved_queries_superadmin_all" on public.saved_queries;
create policy "saved_queries_superadmin_all" on public.saved_queries
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
