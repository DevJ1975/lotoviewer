-- Migration 300: make exec_readonly_sql's row cap actually cap rows.
--
-- Migration 127 wrote the runner as
--
--   select coalesce(jsonb_agg(row_to_json(t)), '[]') from (<sql>) t limit N
--
-- That LIMIT applies to the aggregate's output — a single jsonb row — so the
-- advertised 5,000-row cap never bounded anything: a broad SELECT built one
-- jsonb holding the entire result set in memory before the 10s timeout had a
-- chance to matter. The cap now sits on the operator's query itself.
--
-- Everything else (superadmin check from auth.uid(), shape check, write
-- denylist, read-only transaction, statement timeout, grants) is unchanged
-- from 127. Idempotent.

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

  -- LIMIT on the inner query, so at most `capped` rows are ever aggregated.
  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) q limit %s) t',
    sql_text, capped
  ) into result;

  return result;
end $$;

revoke all on function public.exec_readonly_sql(text, int) from public;
grant execute on function public.exec_readonly_sql(text, int) to authenticated;

comment on function public.exec_readonly_sql(text, int) is
  'Run a read-only SELECT/WITH/EXPLAIN and return the result as jsonb. Caller must be superadmin (auth.uid()). Capped at 5000 rows + 10s; the cap applies to the query, not the aggregate. Read-only transaction enforces no writes.';
