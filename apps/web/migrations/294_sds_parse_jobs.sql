-- Migration 294: Background SDS parse jobs.
--
-- When Claude is unavailable, the SDS parse route hands the PDF to the
-- deterministic parser service (services/sds-parser). A scanned SDS has no text
-- layer, so that service OCRs it — seconds per page, minutes for a long scan.
-- That cannot run inside a Vercel route, so the route enqueues a row here and
-- returns. The service's worker claims the row, parses the PDF, and writes the
-- result to chemical_sds_documents exactly as the synchronous parse does; the
-- SDS Review Queue (/chemicals/review) is where it appears.
--
-- Claiming goes through claim_sds_parse_job(), which uses FOR UPDATE SKIP
-- LOCKED so several worker replicas can drain the queue without two of them
-- taking the same job. PostgREST cannot express SKIP LOCKED (see
-- /api/cron/run-assistant-tasks), hence the RPC.
--
-- A worker that dies mid-job leaves status='running' with a lapsed lease; the
-- next claim takes the job over, until it has used p_max_attempts, after which
-- the claim marks it failed instead of retrying forever.
--
-- Writes are service-role only (the parser service). Tenant members may read
-- their own jobs' status.
--
-- Idempotent.

begin;

create table if not exists public.sds_parse_jobs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  sds_id           uuid not null references public.chemical_sds_documents(id) on delete cascade,
  status           text not null default 'queued'
                   check (status in ('queued','running','succeeded','failed')),
  -- Incremented by every claim, so it doubles as the fencing token a worker
  -- must present to finish the job (a worker whose lease lapsed cannot
  -- overwrite the result of the worker that took over).
  attempts         int  not null default 0 check (attempts >= 0),
  last_error       text,
  -- A queued job is not claimable before this; a retry after a transient
  -- failure pushes it out so one outage cannot burn every attempt at once.
  run_after        timestamptz not null default now(),
  -- Set while running; a claim may take over a running job once this passes.
  lease_expires_at timestamptz,
  requested_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

-- One live job per SDS: re-clicking "Parse" while a job is pending must not
-- queue a second OCR of the same document.
create unique index if not exists sds_parse_jobs_one_live_per_sds
  on public.sds_parse_jobs (sds_id)
  where status in ('queued','running');

-- The claim scan: oldest claimable job first.
create index if not exists sds_parse_jobs_claimable_idx
  on public.sds_parse_jobs (created_at)
  where status in ('queued','running');

create index if not exists sds_parse_jobs_tenant_idx
  on public.sds_parse_jobs (tenant_id, created_at desc);

-- RLS: tenant members read their jobs; no authenticated write policy, so only
-- the service role (which bypasses RLS) can enqueue, claim or finish.
alter table public.sds_parse_jobs enable row level security;
drop policy if exists sds_parse_jobs_tenant_read on public.sds_parse_jobs;
create policy sds_parse_jobs_tenant_read on public.sds_parse_jobs
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create or replace function public.claim_sds_parse_job(p_lease_seconds int, p_max_attempts int)
returns setof public.sds_parse_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A job whose lease lapsed on its final allowed attempt is dead.
  update public.sds_parse_jobs
     set status           = 'failed',
         finished_at      = now(),
         lease_expires_at = null,
         last_error       = coalesce(last_error || ' | ', '') || 'worker lease expired on final attempt'
   where status = 'running'
     and lease_expires_at < now()
     and attempts >= p_max_attempts;

  return query
  update public.sds_parse_jobs j
     set status           = 'running',
         attempts         = j.attempts + 1,
         started_at       = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where j.id = (
     select c.id
       from public.sds_parse_jobs c
      where (c.status = 'queued' and c.run_after <= now())
         or (c.status = 'running' and c.lease_expires_at < now())
      order by c.created_at
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_sds_parse_job(int, int) from public;
revoke all on function public.claim_sds_parse_job(int, int) from anon;
revoke all on function public.claim_sds_parse_job(int, int) from authenticated;
grant execute on function public.claim_sds_parse_job(int, int) to service_role;

notify pgrst, 'reload schema';

commit;
