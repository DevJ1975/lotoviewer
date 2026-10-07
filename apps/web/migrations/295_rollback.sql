-- Rollback for migration 295: generic service jobs.
--
-- Safe at any time: each kind's results live in its own tables, so dropping the
-- queue loses only jobs that had not finished. Stop the service's worker
-- (SERVICE_JOBS_ENABLED) first so it stops claiming.

begin;

drop function if exists public.heartbeat_service_job(uuid, int, int, jsonb);
drop function if exists public.claim_service_job(text[], int);
drop table if exists public.service_jobs;

notify pgrst, 'reload schema';

commit;
