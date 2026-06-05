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
-- The generated column is STORED so the trigram GIN index can sit on it.
-- array_to_string with a constant separator is immutable, which both the
-- generated-column expression and the index require.
--
-- Idempotent — `if not exists` on the column, the extension, and the index.
-- pg_trgm is already enabled by migration 089.

begin;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm;
  end if;
end $$;

alter table public.chemical_products
  add column if not exists synonyms_text text
    generated always as (array_to_string(synonyms, ' ')) stored;

create index if not exists idx_chem_products_synonyms_trgm
  on public.chemical_products
  using gin (synonyms_text gin_trgm_ops);

commit;
