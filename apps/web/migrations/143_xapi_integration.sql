-- Migration 143: xAPI (Experience API / Tin Can) integration.
--
-- Why: customers running corporate LMSs want LOTO sign-offs, photo
-- validations, and equipment interactions to surface as learning
-- activity in their existing reporting stack (Watershed, Veracity,
-- SCORM Cloud, Learning Locker, etc.). The xAPI 1.0.3 spec models
-- each event as an Actor / Verb / Object Statement posted to an LRS.
--
-- Shape:
--   1. loto_xapi_endpoints     — one LRS configuration per tenant.
--                                 Stores endpoint URL + Basic auth
--                                 key/secret. Inactive rows are
--                                 ignored by the emitter.
--   2. loto_xapi_statements    — audit + outbox row per emitted
--                                 Statement. Lets operators answer
--                                 "did this customer's LRS receive
--                                 X?" without dumping pg_net guts.
--
-- Both tables are tenant-scoped through the same active_tenant_id()
-- / current_user_tenant_ids() helpers introduced in migration 131,
-- matching every other domain table on this app.

begin;

-- ──────────────────────────────────────────────────────────────────────
-- 1. loto_xapi_endpoints — per-tenant LRS configuration
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.loto_xapi_endpoints (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- The LRS Statement endpoint. xAPI 1.0.3 §7 requires https://
  -- in production; we enforce http(s):// only at insert time.
  endpoint_url  text not null,
  -- Basic-auth credentials. Most LRS vendors hand out a key/secret
  -- pair scoped to a single application. Stored as plaintext today —
  -- equivalent to the existing webhook secret in migration 013 —
  -- because the row sits behind RLS + service-role-only writes.
  auth_key      text not null,
  auth_secret   text not null,
  -- xAPI spec version sent in the X-Experience-API-Version header.
  -- 1.0.3 is the LRS-supported floor; 2.0 conformance still patchy
  -- across vendors at time of writing.
  version       text not null default '1.0.3',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One LRS per tenant. Multiple destinations isn't a real customer
  -- ask yet; if it becomes one, lift the unique constraint and add
  -- a "destinations[]" join table.
  constraint loto_xapi_endpoints_tenant_unique unique (tenant_id),
  constraint loto_xapi_endpoints_http_only
    check (endpoint_url ~* '^https?://')
);

create index if not exists idx_loto_xapi_endpoints_active
  on public.loto_xapi_endpoints(tenant_id)
  where active = true;

comment on table public.loto_xapi_endpoints is
  'Per-tenant xAPI LRS configuration. The emitter posts xAPI Statements to endpoint_url with Basic auth_key:auth_secret and X-Experience-API-Version: version.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. loto_xapi_statements — per-emit audit + outbox
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.loto_xapi_statements (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  endpoint_id      uuid references public.loto_xapi_endpoints(id) on delete set null,
  -- The Statement id sent to the LRS. xAPI §4.1.1 makes it a v4 UUID
  -- so the LRS can dedupe on retry. We generate it server-side rather
  -- than letting the LRS mint one, so the audit row links to it.
  statement_id     uuid not null,
  actor_email      text,
  verb_id          text not null,
  object_id        text not null,
  -- Full Statement as posted, retained for replay / debugging.
  statement        jsonb not null,
  status           text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed', 'skipped')),
  response_status  int,
  response_body    text,
  error            text,
  fired_at         timestamptz not null default now(),
  completed_at     timestamptz,
  -- Increments on every retry. Today the emitter is single-attempt;
  -- the column is here so a future cron-driven retry can update in
  -- place rather than write a second audit row.
  attempt_count    int not null default 1,
  constraint loto_xapi_statements_statement_id_unique unique (statement_id)
);

create index if not exists idx_loto_xapi_statements_tenant_recent
  on public.loto_xapi_statements (tenant_id, fired_at desc);

create index if not exists idx_loto_xapi_statements_status_pending
  on public.loto_xapi_statements (status, fired_at)
  where status in ('pending', 'failed');

comment on table public.loto_xapi_statements is
  'One row per xAPI Statement emission attempt. status=sent means the LRS returned 2xx; failed means it did not. Replays should reuse statement_id so the LRS dedupes.';

-- ──────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger on endpoints
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.tg_loto_xapi_endpoints_touch()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists loto_xapi_endpoints_touch on public.loto_xapi_endpoints;
create trigger loto_xapi_endpoints_touch
  before update on public.loto_xapi_endpoints
  for each row execute function public.tg_loto_xapi_endpoints_touch();

-- ──────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────
alter table public.loto_xapi_endpoints  enable row level security;
alter table public.loto_xapi_statements enable row level security;

-- Endpoints: read by any tenant member (so the client can know the
-- module is configured); write only by tenant admins or superadmin
-- (credentials are sensitive — non-admins must not rotate them).
drop policy if exists loto_xapi_endpoints_tenant_read on public.loto_xapi_endpoints;
create policy loto_xapi_endpoints_tenant_read on public.loto_xapi_endpoints
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists loto_xapi_endpoints_admin_write on public.loto_xapi_endpoints;
create policy loto_xapi_endpoints_admin_write on public.loto_xapi_endpoints
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

-- Statements: read by tenant members; writes only happen via
-- service-role from the emit route, so no insert/update policy is
-- needed for authenticated users.
drop policy if exists loto_xapi_statements_tenant_read on public.loto_xapi_statements;
create policy loto_xapi_statements_tenant_read on public.loto_xapi_statements
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

commit;
