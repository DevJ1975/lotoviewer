-- Migration 109: extend knowledge_source_type with 'manual'.
--
-- Lets the RAG retrieval pipeline treat published Soteria user manuals
-- as a first-class corpus alongside regulations, state regs, DOT, EPA,
-- RCRA, and per-tenant company policies. A new helper at
-- apps/web/lib/ai/syncManualToRag.ts ingests manual bodies into
-- knowledge_documents + knowledge_chunks on every publish; the bulk
-- sync endpoint at /api/superadmin/manuals/sync-rag backfills the
-- seven manuals seeded by migration 108 and any others added since.
--
-- Manuals are platform-wide content (tenant_id = NULL on
-- knowledge_documents) so every tenant's assistant can cite them.
-- Drafts (manuals.published_at IS NULL) are NOT ingested — only
-- published bodies feed the RAG corpus.
--
-- ALTER TYPE ... ADD VALUE has to live in its own transaction so the
-- value is committed before any code path uses it. Don't merge this
-- into 108 or any later usage migration.

alter type public.knowledge_source_type add value if not exists 'manual';
