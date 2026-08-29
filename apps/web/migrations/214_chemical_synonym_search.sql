-- Migration 214: make chemical_products synonyms searchable.
--
-- The product search (GET /api/chemicals/products) trigram-matches `name`
-- via idx_chem_products_name_trgm (migration 089), but synonyms — the
-- alternate names a worker is just as likely to type ("propan-2-one" for
-- acetone) — were never searchable. The search runs through PostgREST's
-- `.or(...ilike...)`, which can only target a real column, not a SQL
-- expression like array_to_string(synonyms,' '). So we materialize the
-- flattened synonyms into a generated column and trigram-index THAT; the
-- route then adds a plain `synonyms_text.ilike` clause to the OR.
--
-- WHY the wrapper function: a STORED generated column (and the trigram
-- index) require an IMMUTABLE expression, but Postgres marks the built-in
-- `array_to_string` as STABLE (provolatile='s') — generic over element
-- type — so it cannot back a generated column directly. Flattening a
-- text[] with a constant separator IS deterministic, so we expose it
-- through a thin IMMUTABLE SQL wrapper that the generated column can use.
--
-- Idempotent — `create or replace` on the function, `if not exists` on the
-- column and the index. pg_trgm is already enabled by migration 089.

begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm;
  end if;
end $$;

create or replace function chemical_synonyms_text(vals text[])
  returns text
  language sql
  immutable
  parallel safe
as $$ select array_to_string(vals, ' ') $$;

alter table public.chemical_products
  add column if not exists synonyms_text text
    generated always as (chemical_synonyms_text(synonyms)) stored;

create index if not exists idx_chem_products_synonyms_trgm
  on public.chemical_products
  using gin (synonyms_text gin_trgm_ops);

commit;
