-- Rollback for migration 294: background SDS parse jobs.
--
-- Safe at any time: parse results already live on chemical_sds_documents, so
-- dropping the queue loses only jobs that had not finished. Disable the
-- service's worker (SDS_PARSE_JOBS_ENABLED) first so it stops claiming.

begin;

drop function if exists public.claim_sds_parse_job(int, int);
drop table if exists public.sds_parse_jobs;

notify pgrst, 'reload schema';

commit;
