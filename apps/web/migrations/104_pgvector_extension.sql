-- Migration 104: pgvector extension.
--
-- Foundation for the RAG knowledge base in migration 105. We require
-- pgvector ≥ 0.7.0 because that's where HNSW landed; older versions
-- fall back to IVFFLAT which the next migration's index won't compile
-- against. Supabase has shipped pgvector >=0.7 for a while, so this
-- should be a no-op in production but is required for fresh local dbs.

begin;

create extension if not exists vector;

commit;
