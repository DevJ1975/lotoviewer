-- Rollback for migration 296: environmental document reader.
--
-- DESTRUCTIVE. Dropping document_extractions discards the reviewer's decisions
-- and the record of which documents produced which calendar obligations. The
-- obligations themselves (compliance_calendar_obligations) are left in place.
-- The uploaded PDFs in the `environmental-docs` bucket are NOT deleted here:
-- Supabase refuses to drop a non-empty bucket from SQL, and they are the only
-- copy of the source documents. Empty the bucket from the dashboard first if
-- they should go too.
--
-- Stop the service's document_extract worker first (or leave migration 295 in
-- place; queued jobs for a missing table simply fail permanently).
--
-- Idempotent.

begin;

drop table if exists public.document_extractions;

notify pgrst, 'reload schema';

commit;
