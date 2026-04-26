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
      alter column attendants type text[]
        using array(select x::text from unnest(attendants) x),
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
      alter column entrants type text[]
        using array(select x::text from unnest(entrants) x),
      alter column entrants set default '{}'::text[],
      alter column entrants set not null;
    raise notice '[010] converted entrants uuid[] -> text[]';
  end if;

  -- ── isolation_measures  jsonb → text[] ────────────────────────────────
  -- Existing rows can carry either an array of strings or an array of
  -- structured objects. The conversion handles both: string elements
  -- come through as their text value; non-string elements are
  -- JSON-stringified so nothing silently disappears.
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
        using (
          case
            when isolation_measures is null
              or jsonb_typeof(isolation_measures) <> 'array'
            then '{}'::text[]
            else array(
              select case jsonb_typeof(elem)
                when 'string' then elem #>> '{}'
                else elem::text
              end
              from jsonb_array_elements(isolation_measures) elem
            )
          end
        ),
      alter column isolation_measures set default '{}'::text[],
      alter column isolation_measures set not null;
    raise notice '[010] converted isolation_measures jsonb -> text[]';
  end if;
end $$;
