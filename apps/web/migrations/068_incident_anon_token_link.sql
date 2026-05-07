-- Migration 068: Audit cleanup — replace description-tag rate-limiting
-- with a proper FK column.
--
-- Phase 6 (migration 067 + /api/anonymous-report) tagged the
-- description with `[anon-token:<uuid>] ` as a prefix so the rate-
-- limit counter could find prior submissions via ILIKE. The devjr
-- audit caught the tag leaking into every downstream surface
-- (300 log, 301 PDF, AI suggest input, lessons library, repeat
-- detector). This migration:
--
--   1. Adds incidents.anon_token_id — proper FK to
--      incident_anon_intake_tokens, replacing the description tag.
--   2. Back-fills the column from any existing tagged descriptions.
--   3. Strips the tag from descriptions so downstream surfaces see
--      only the worker's actual narrative.
--
-- After this migration the route's rate-limit query becomes a clean
-- `.eq('anon_token_id', t.id)` and the description-stripping
-- workaround in the email helper goes away.

begin;

alter table public.incidents
  add column if not exists anon_token_id uuid
    references public.incident_anon_intake_tokens(id) on delete set null;

create index if not exists idx_incidents_anon_token
  on public.incidents(anon_token_id, reported_at desc)
  where anon_token_id is not null;

-- Back-fill any existing rows that carry a `[anon-token:<uuid>] ` prefix.
-- We extract the uuid via a regex match and then strip the prefix.
do $$
declare
  v_count int;
begin
  with extracted as (
    select id,
           (regexp_matches(description, '^\[anon-token:([0-9a-f-]{36})\]\s*'))[1]::uuid as token_id,
           regexp_replace(description, '^\[anon-token:[0-9a-f-]{36}\]\s*', '') as clean_desc
      from public.incidents
     where description like '[anon-token:%'
  )
  update public.incidents inc
     set anon_token_id = e.token_id,
         description   = e.clean_desc
    from extracted e
   where inc.id = e.id;
  get diagnostics v_count = row_count;
  raise notice 'migration 068: cleaned % anon-tagged incident descriptions', v_count;
end $$;

notify pgrst, 'reload schema';

commit;
