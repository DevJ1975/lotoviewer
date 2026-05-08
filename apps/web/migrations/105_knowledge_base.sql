-- Migration 105: knowledge base for RAG retrieval.
--
-- PR2 of the AI redesign. Two tables:
--   - knowledge_documents — one row per uploaded source (regulation,
--     state reg, DOT, EPA, RCRA, or company policy). tenant_id IS NULL
--     means the document is GLOBAL (shared across all tenants); a
--     non-null tenant_id means it's a private company policy visible
--     only to that tenant's members.
--   - knowledge_chunks — N rows per document, each carrying a 1024-dim
--     Voyage AI embedding (voyage-3-large) and the chunk text. HNSW
--     index on cosine distance keeps top-K retrieval fast at scale.
--
-- Search RPC `match_knowledge_chunks` runs the cosine search server-
-- side under the requester's JWT so RLS automatically scopes the
-- result set: only chunks the user can see (global + own tenant)
-- come back. The route doesn't need to filter — pgvector + RLS does
-- the work.

begin;

-- ── enums ────────────────────────────────────────────────────────────────

do $$ begin
  create type public.knowledge_source_type as enum (
    'regulation',     -- 29 CFR 1910 / 1926 (federal OSHA)
    'state_reg',      -- e.g. CalOSHA, MIOSHA — jurisdiction column says which
    'dot',            -- 49 CFR (DOT hazmat transport)
    'epa',            -- 40 CFR (EPA — clean air, clean water, etc.)
    'rcra',           -- 40 CFR 260-272 (RCRA hazardous waste — split out from EPA
                      -- because RCRA queries are common enough to filter cheaply)
    'company_policy'  -- per-tenant uploaded document
  );
exception
  when duplicate_object then null;
end $$;

-- ── knowledge_documents ──────────────────────────────────────────────────

create table if not exists public.knowledge_documents (
  id              uuid primary key default gen_random_uuid(),
  -- NULL = global document visible to every tenant (regulations etc.).
  -- Non-null = company policy private to that tenant.
  tenant_id       uuid references public.tenants(id) on delete cascade,
  source_type     public.knowledge_source_type not null,
  title           text not null check (length(trim(title)) between 1 and 300),
  -- Optional metadata. jurisdiction is the state code for state_reg;
  -- effective_date is when the regulation/policy took effect (used in
  -- citations); source_url is the canonical link (eCFR, an internal
  -- intranet URL for a company policy, etc.).
  jurisdiction    text,
  effective_date  date,
  source_url      text,
  -- Whoever uploaded it. NULL when ingested via the offline regs CLI.
  uploaded_by     uuid references public.profiles(id),
  -- Content checksum (sha256 hex). Used by the ingestion CLI to skip
  -- documents that haven't changed since the last run, and by the
  -- upload route to detect duplicate uploads of the same file.
  content_sha256  text not null,
  -- Total chunks created. Maintained by the upload + ingestion code,
  -- never by triggers — chunks may be deleted independently.
  chunk_count     int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_knowledge_documents_tenant
  on public.knowledge_documents (tenant_id, created_at desc);

create index if not exists idx_knowledge_documents_source_type
  on public.knowledge_documents (source_type, created_at desc);

-- One global document with the same checksum should never be ingested
-- twice. Per-tenant policies are scoped per (tenant_id, sha) so two
-- tenants can independently upload the same boilerplate without
-- colliding.
create unique index if not exists ux_knowledge_documents_global_sha
  on public.knowledge_documents (content_sha256)
  where tenant_id is null;

create unique index if not exists ux_knowledge_documents_tenant_sha
  on public.knowledge_documents (tenant_id, content_sha256)
  where tenant_id is not null;

-- ── knowledge_chunks ─────────────────────────────────────────────────────

create table if not exists public.knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index  int  not null check (chunk_index >= 0),
  text         text not null check (length(text) between 1 and 8000),
  -- Voyage AI voyage-3-large is 1024 dims. Pinning the size at the
  -- column means a model swap (e.g. to voyage-3-lite at 512 dims)
  -- requires a deliberate migration — the right blast radius.
  embedding    vector(1024) not null,
  token_count  int,
  -- Free-form metadata: section number ("§ 1910.147(c)(4)"), page
  -- number for PDFs, section heading for markdown, etc. Used by the
  -- citation renderer in the assistant UI.
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

-- HNSW index over cosine distance. m=16 / ef_construction=64 are the
-- pgvector defaults that work well for corpora up to several million
-- chunks; we don't expect to exceed that here.
create index if not exists idx_knowledge_chunks_embedding_hnsw
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists idx_knowledge_chunks_document
  on public.knowledge_chunks (document_id, chunk_index);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Documents:
--   - global documents (tenant_id IS NULL) are visible to any authed user
--   - tenant policies are visible only to members of that tenant
--   - inserts/updates/deletes are superadmin-only — operators manage the
--     corpus from /superadmin/policies, and the regs CLI runs as service
--     role which bypasses RLS entirely.

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks    enable row level security;

drop policy if exists "knowledge_documents_global_read"     on public.knowledge_documents;
drop policy if exists "knowledge_documents_tenant_read"     on public.knowledge_documents;
drop policy if exists "knowledge_documents_superadmin_all"  on public.knowledge_documents;

create policy "knowledge_documents_global_read" on public.knowledge_documents
  for select to authenticated
  using (tenant_id is null);

create policy "knowledge_documents_tenant_read" on public.knowledge_documents
  for select to authenticated
  using (
    tenant_id is not null
    and tenant_id in (select public.current_user_tenant_ids())
  );

create policy "knowledge_documents_superadmin_all" on public.knowledge_documents
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

drop policy if exists "knowledge_chunks_read_via_doc"   on public.knowledge_chunks;
drop policy if exists "knowledge_chunks_superadmin_all" on public.knowledge_chunks;

-- Chunk read piggybacks on the parent document's read policy — if you
-- can see the document, you can see its chunks.
create policy "knowledge_chunks_read_via_doc" on public.knowledge_chunks
  for select to authenticated
  using (
    exists (
      select 1 from public.knowledge_documents d
      where d.id = document_id
        and (
          d.tenant_id is null
          or d.tenant_id in (select public.current_user_tenant_ids())
        )
    )
  );

create policy "knowledge_chunks_superadmin_all" on public.knowledge_chunks
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- ── similarity search RPC ────────────────────────────────────────────────
--
-- Takes a query embedding + filters and returns the top-K matching
-- chunks with their parent document metadata. RLS automatically
-- scopes the chunk join — global + own-tenant only.
--
-- We expose an RPC instead of having the client run cosine search
-- directly because:
--   1. The client doesn't have to know HNSW operator syntax.
--   2. We can tune k / ef_search / source-type filtering server-side
--      without a route redeploy.
--   3. Postgres-side limit + rank means smaller payloads.
create or replace function public.match_knowledge_chunks(
  query_embedding   vector(1024),
  match_count       int default 8,
  source_filter     public.knowledge_source_type[] default null,
  tenant_filter     uuid default null
)
returns table (
  chunk_id        uuid,
  document_id     uuid,
  chunk_index     int,
  text            text,
  metadata        jsonb,
  source_type     public.knowledge_source_type,
  title           text,
  jurisdiction    text,
  effective_date  date,
  source_url      text,
  doc_tenant_id   uuid,
  similarity      float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as chunk_id,
    d.id as document_id,
    c.chunk_index,
    c.text,
    c.metadata,
    d.source_type,
    d.title,
    d.jurisdiction,
    d.effective_date,
    d.source_url,
    d.tenant_id as doc_tenant_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks c
  join public.knowledge_documents d on d.id = c.document_id
  where
    (source_filter is null or d.source_type = any(source_filter))
    and (
      -- Caller asked for only this tenant's policies. The RLS layer
      -- already enforces visibility; this is a *narrowing* filter.
      tenant_filter is null
      or d.tenant_id is null
      or d.tenant_id = tenant_filter
    )
  order by c.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

grant execute on function public.match_knowledge_chunks(
  vector(1024), int, public.knowledge_source_type[], uuid
) to authenticated;

notify pgrst, 'reload schema';

commit;
