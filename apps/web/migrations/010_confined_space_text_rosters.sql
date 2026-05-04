-- Migration 010: convert confined-space permit roster + isolation columns
-- to text[].
--
-- Migration 009 was published in two forms on the feat/confined-spaces
-- branch — first with attendants/entrants as uuid[] and isolation_measures
-- as jsonb, then (commit 25055c8) simplified to text[] across all three
-- because field entrants typically don't have app accounts and OSHA only
-- requires names on the permit, not links to an HR/auth identity.
--
-- This migration brings any DB that ran the original 009 in line with
-- what the app code (and the demo seed) expects. It's a no-op against
-- a DB where 009 was applied AFTER the simplification, because each
-- ALTER is guarded by an information_schema column-type check.
--
-- Safe on tables with existing data: each conversion preserves whatever
-- is there. uuid[] → text[] casts each uuid to its string form;
-- jsonb → text[] takes string elements as text and stringifies objects
-- so nothing is lost.
--
-- Implementation note: Postgres rejects `array(SELECT ...)` subqueries
-- inside ALTER TABLE ... USING (`0A000: cannot use subquery in transform
-- expression`). The uuid[] → text[] case sidesteps this with a direct
-- ::text[] cast since uuid is castable to text element-wise. The jsonb
-- case uses a session-scoped helper (pg_temp.*) so the USING clause is
-- a single function call rather than a subquery.

-- Session-scoped helper: convert a jsonb array of strings/objects to a
-- text[]. Auto-dropped at session end (pg_temp).
create or replace function pg_temp._jsonb_to_text_array(j jsonb)
  returns text[]
  language sql
  immutable
as $$
  select coalesce(
    array_agg(
      case jsonb_typeof(elem)
        when 'string' then elem #>> '{}'
        else elem::text
      end
    ),
    '{}'::text[]
  )
  from jsonb_array_elements(coalesce(j, '[]'::jsonb)) elem
$$;

do $$
begin
  -- ── attendants  uuid[] → text[] ───────────────────────────────────────
  if (
    select udt_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loto_confined_space_permits'
       and column_name  = 'attendants'
  ) = '_uuid' then
    alter table public.loto_confined_space_permits
      alter column attendants drop default,
      alter column attendants type text[] using attendants::text[],
      alter column attendants set default '{}'::text[],
      alter column attendants set not null;
    raise notice '[010] converted attendants uuid[] -> text[]';
  end if;

  -- ── entrants    uuid[] → text[] ───────────────────────────────────────
  if (
    select udt_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loto_confined_space_permits'
       and column_name  = 'entrants'
  ) = '_uuid' then
    alter table public.loto_confined_space_permits
      alter column entrants drop default,
      alter column entrants type text[] using entrants::text[],
      alter column entrants set default '{}'::text[],
      alter column entrants set not null;
    raise notice '[010] converted entrants uuid[] -> text[]';
  end if;

  -- ── isolation_measures  jsonb → text[] ────────────────────────────────
  -- Existing rows can carry either an array of strings or an array of
  -- structured objects. The pg_temp helper handles both: string elements
  -- come through as their text value; non-string elements are JSON-
  -- stringified so nothing silently disappears.
  if (
    select data_type
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'loto_confined_space_permits'
       and column_name  = 'isolation_measures'
  ) = 'jsonb' then
    alter table public.loto_confined_space_permits
      alter column isolation_measures drop default,
      alter column isolation_measures type text[]
        using pg_temp._jsonb_to_text_array(isolation_measures),
      alter column isolation_measures set default '{}'::text[],
      alter column isolation_measures set not null;
    raise notice '[010] converted isolation_measures jsonb -> text[]';
  end if;
end $$;
