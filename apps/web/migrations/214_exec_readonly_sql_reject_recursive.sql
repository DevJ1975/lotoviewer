-- Migration 214: reject WITH RECURSIVE in exec_readonly_sql.
--
-- The saved-queries executor (mig 127) gates on regex `^\s*(with|select|explain)\s`
-- + a read-only transaction + a 10s statement_timeout. The transaction
-- blocks writes; the timeout caps runaway queries. But a RECURSIVE CTE
-- can generate millions of rows in memory before either trip-wire
-- fires, defeating the per-row cap:
--
--   WITH RECURSIVE cnt(x) AS (
--     SELECT 1
--     UNION ALL
--     SELECT x + 1 FROM cnt WHERE x < 100000000
--   ) SELECT * FROM cnt;
--
-- Superadmin-gated, read-only, time-bounded — so contained — but a
-- single bad query still burns ~10s of CPU + working memory. We add
-- an explicit reject up-front so the operator gets a useful 4xx
-- instead of a 10-second timeout.

begin;

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

  -- Must lead with SELECT / WITH / EXPLAIN. Defense in depth: the API
  -- enforces this too.
  if sql_text !~* '^\s*(with\s|select\s|explain\s)' then
    raise exception 'Only SELECT, WITH, or EXPLAIN statements are allowed' using errcode = '42501';
  end if;

  -- Statement-stuffing guard: a DML/DDL keyword after a semicolon
  -- would still be blocked by transaction_read_only, but we fail
  -- loud here with a clearer message.
  if sql_text ~* ';\s*(insert|update|delete|drop|truncate|alter|create|grant|revoke|refresh|reindex|vacuum|comment\s+on)\b' then
    raise exception 'Compound statements with writes are not allowed' using errcode = '42501';
  end if;

  -- RECURSIVE-CTE guard: a recursive WITH can generate arbitrary row
  -- counts in memory inside the 10s timeout window, evading the
  -- max_rows cap. Reject it. Operators with a legitimate recursive
  -- use case can run it directly in the Supabase SQL editor.
  if sql_text ~* '^\s*with\s+recursive\b' then
    raise exception 'WITH RECURSIVE is not allowed in saved queries' using errcode = '42501';
  end if;

  set local statement_timeout = '10s';
  set local transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (%s) t limit %s',
    sql_text, capped
  ) into result;

  return result;
end $$;

comment on function public.exec_readonly_sql(text, int) is
  'Run a read-only SELECT/WITH/EXPLAIN and return the result as jsonb. Caller must be superadmin. Capped at 5000 rows + 10s, RECURSIVE CTEs rejected. Read-only transaction enforces no writes.';

commit;
