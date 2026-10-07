-- Rollback for migration 297: regulation loading functions.
--
-- Drops the three functions only. Documents the service already loaded stay in
-- knowledge_documents / knowledge_chunks, and regulation_update_checks rows it
-- created stay too (they record real ingests). Stop the service's
-- regulation_ingest jobs first; a job started now would fail on the missing
-- functions.
--
-- Idempotent.

begin;

drop function if exists public.record_regulation_snapshot(text, text, text, text, date);
drop function if exists public.prune_regulation_documents(text, text[]);
drop function if exists public.replace_regulation_document(text, text, text, text, text, jsonb);

notify pgrst, 'reload schema';

commit;
