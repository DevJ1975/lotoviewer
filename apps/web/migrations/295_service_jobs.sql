-- Migration 295: Generic background jobs for the Python service.
--
-- Migration 294 gave the SDS parser its own durable queue. The same service now
-- also reads uploaded environmental documents, loads regulations into the
-- shared knowledge base, and imports history exports — all slower than a Vercel
-- route can wait. Rather than one table per feature, this is one queue keyed by
-- `kind`; the service decides which kinds it can run, so a new kind needs no
-- migration. (294's sds_parse_jobs is left as it is; it works, and moving it
-- over is a separate change.)
--
-- Same guarantees as 294: claiming uses FOR UPDATE SKIP LOCKED so replicas never
-- double-process, `attempts` is the fencing token a worker must present to
-- finish or extend a job, and a job whose worker died is taken over once its
-- lease lapses, until `max_attempts` is used up.
--
-- Two additions over 294:
--   * heartbeat_service_job() lets a long job extend its own lease between
--     units of work (an OCR page, an embedding batch) and report progress, so
--     the lease only has to cover one unit, not the slowest whole job. It
--     returns false once the lease was lost, telling the worker to stop.
--   * tenant_id is nullable: a platform-level job (loading regulations into the
--     shared knowledge base) belongs to no tenant and is readable only by
--     superadmins.
--
-- `payload` carries inputs and `result` a summary — never secrets; both are
-- readable by tenant members.
--
-- Writes are service-role only. Idempotent.

begin;

create table if not exists public.service_jobs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenants(id) on delete cascade,
  -- Free-form so a new kind needs no migration; the shape is enforced here and
  -- the set of valid kinds by the service's handler registry.
  kind             text not null check (kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  payload          jsonb not null default '{}'::jsonb
                   check (octet_length(payload::text) <= 65536),
  -- Optional. At most one live (queued/running) job per (kind, tenant, key), so
  -- re-clicking "extract" on the same document cannot queue a second OCR.
  dedupe_key       text,
  status           text not null default 'queued'
                   check (status in ('queued','running','succeeded','failed')),
  -- Incremented by every claim; the fencing token for finishing or extending.
  attempts         int  not null default 0 check (attempts >= 0),
  max_attempts     int  not null default 3 check (max_attempts between 1 and 10),
  -- A retry after a transient failure pushes this out so one outage cannot burn
  -- every attempt at once.
  run_after        timestamptz not null default now(),
  -- Set while running; a claim may take over a running job once this passes.
  lease_expires_at timestamptz,
  progress         jsonb,
  result           jsonb check (result is null or octet_length(result::text) <= 262144),
  last_error       text,
  requested_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

create unique index if not exists service_jobs_one_live_per_key
  on public.service_jobs (kind, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key)
  where dedupe_key is not null and status in ('queued','running');

-- The claim scan: oldest claimable job first.
create index if not exists service_jobs_claimable_idx
  on public.service_jobs (created_at)
  where status in ('queued','running');

create index if not exists service_jobs_tenant_idx
  on public.service_jobs (tenant_id, created_at desc);

-- RLS: tenant members read their tenant's jobs, superadmins read platform jobs;
-- no authenticated write policy, so only the service role can enqueue, claim,
-- extend or finish.
alter table public.service_jobs enable row level security;
drop policy if exists service_jobs_read on public.service_jobs;
create policy service_jobs_read on public.service_jobs
  for select to authenticated
  using (
    (tenant_id is null and public.is_superadmin())
    or (
      tenant_id is not null
      and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
      and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    )
  );

create or replace function public.claim_service_job(p_kinds text[], p_lease_seconds int)
returns setof public.service_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- A job whose lease lapsed on its final allowed attempt is dead, whichever
  -- kind it is.
  update public.service_jobs
     set status           = 'failed',
         finished_at      = now(),
         lease_expires_at = null,
         last_error       = coalesce(last_error || ' | ', '') || 'worker lease expired on final attempt'
   where status = 'running'
     and lease_expires_at < now()
     and attempts >= max_attempts;

  return query
  update public.service_jobs j
     set status           = 'running',
         attempts         = j.attempts + 1,
         started_at       = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where j.id = (
     select c.id
       from public.service_jobs c
      where c.kind = any(p_kinds)
        and ((c.status = 'queued' and c.run_after <= now())
          or (c.status = 'running' and c.lease_expires_at < now()))
      order by c.created_at
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;

-- Extends the lease and records progress. True while this attempt still holds
-- the job; false once it was taken over (or finished), and the worker must
-- stop touching it.
create or replace function public.heartbeat_service_job(
  p_id uuid, p_attempts int, p_lease_seconds int, p_progress jsonb default null
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with extended as (
    update public.service_jobs
       set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           progress         = coalesce(p_progress, progress)
     where id = p_id and status = 'running' and attempts = p_attempts
    returning 1
  )
  select exists (select 1 from extended);
$$;

revoke all on function public.claim_service_job(text[], int) from public;
revoke all on function public.claim_service_job(text[], int) from anon;
revoke all on function public.claim_service_job(text[], int) from authenticated;
grant execute on function public.claim_service_job(text[], int) to service_role;

revoke all on function public.heartbeat_service_job(uuid, int, int, jsonb) from public;
revoke all on function public.heartbeat_service_job(uuid, int, int, jsonb) from anon;
revoke all on function public.heartbeat_service_job(uuid, int, int, jsonb) from authenticated;
grant execute on function public.heartbeat_service_job(uuid, int, int, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
