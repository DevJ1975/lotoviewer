-- Migration 300: STRIKE xAPI (Experience API 1.0.3) sync to a tenant's LMS.
--
-- Any LMS with an LRS (Learning Record Store) accepts xAPI statements, so one
-- outbound integration covers them all. Two tables:
--
--   strike_lrs_endpoints     one LRS per tenant: statements endpoint + Basic
--                            auth credentials. Service role only: no policy
--                            lets a browser read the password, and the admin
--                            API never returns it.
--   strike_xapi_statements   the outbox. The grading and evidence paths append
--                            a statement per learning event (only while the
--                            tenant has an enabled endpoint); the
--                            /api/cron/strike-xapi-sync cron POSTs them and
--                            stamps sent_at. The id IS the xAPI statement id,
--                            derived from (attempt, verb, activity), so a
--                            retried request can't enqueue a duplicate and a
--                            re-sent statement is one the LRS already has.
--
-- Idempotent.

begin;

create table if not exists public.strike_lrs_endpoints (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  endpoint         text not null check (endpoint ~ '^https://' and length(endpoint) <= 500),
  auth_username    text not null check (length(auth_username) between 1 and 300),
  auth_password    text not null check (length(auth_password) between 1 and 500),
  enabled          boolean not null default true,
  updated_by       uuid references auth.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz
);

alter table public.strike_lrs_endpoints enable row level security;
revoke all on public.strike_lrs_endpoints from anon, authenticated;

create table if not exists public.strike_xapi_statements (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  attempt_id   uuid references public.strike_attempts(id) on delete set null,
  verb         text not null check (verb in ('attempted', 'experienced', 'answered', 'completed', 'passed', 'failed')),
  statement    jsonb not null,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  tries        int not null default 0,
  next_try_at  timestamptz not null default now(),
  last_error   text
);

create index if not exists strike_xapi_statements_due_idx
  on public.strike_xapi_statements(next_try_at)
  where sent_at is null;
create index if not exists strike_xapi_statements_tenant_idx
  on public.strike_xapi_statements(tenant_id, created_at desc);

alter table public.strike_xapi_statements enable row level security;
revoke all on public.strike_xapi_statements from anon, authenticated;

notify pgrst, 'reload schema';

commit;
