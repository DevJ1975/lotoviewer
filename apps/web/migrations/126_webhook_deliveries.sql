-- Migration 126: loto_webhook_deliveries — per-attempt audit trail.
--
-- Today fire_webhooks() (mig 013) shells events out via pg_net.http_post
-- and the response disappears into net._http_response with no link back
-- to which subscription / event the row was for. Operators can't answer
-- "did this customer's webhook go through?" without poking pg_net guts.
--
-- This migration:
--   1. Adds loto_webhook_deliveries — one row per (subscription, event)
--      attempt, with the pg_net request id captured at fire time.
--   2. Replaces public.fire_webhooks() so it ALSO inserts a delivery
--      row and stamps it with the request_id pg_net handed back.
--   3. Adds public.reconcile_webhook_deliveries(limit) — pulls finished
--      rows from net._http_response and patches the delivery rows.
--      Called by /api/cron/webhook-reconcile on a 5-min schedule.
--
-- Subscription identity is snapshotted (name + URL) onto each delivery
-- so the audit trail survives rename / delete of the parent subscription.
-- Tenant is derived from payload->>'tenant_id' when present (every
-- domain row has it post-mig 029); NULL is fine — superadmin tooling
-- filters by tenant when set, lists everything otherwise.

begin;

-- ──────────────────────────────────────────────────────────────────────
-- 1. Table
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.loto_webhook_deliveries (
  id                bigserial primary key,
  tenant_id         uuid references public.tenants(id) on delete set null,
  subscription_id   uuid references public.loto_webhook_subscriptions(id) on delete set null,
  -- Snapshot so a delivery row survives the parent subscription being
  -- renamed or deleted. The audit value here is "this URL got hit
  -- with this payload at this time".
  subscription_name text,
  subscription_url  text not null,
  event             text not null,
  payload           jsonb not null,
  -- pg_net request handle. NULL if pg_net wasn't installed (the
  -- delivery is logged anyway so the operator sees the gap).
  request_id        bigint,
  -- Reconciler fills these from net._http_response on a cron tick.
  response_status   int,
  response_body     text,           -- truncated to 4 KB on insert
  response_headers  jsonb,
  error             text,
  duration_ms       int,
  fired_at          timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists idx_webhook_deliveries_recent
  on public.loto_webhook_deliveries (fired_at desc);

create index if not exists idx_webhook_deliveries_tenant
  on public.loto_webhook_deliveries (tenant_id, fired_at desc)
  where tenant_id is not null;

create index if not exists idx_webhook_deliveries_subscription
  on public.loto_webhook_deliveries (subscription_id, fired_at desc)
  where subscription_id is not null;

-- Unfinished deliveries — what the reconciler scans every tick.
create index if not exists idx_webhook_deliveries_open
  on public.loto_webhook_deliveries (request_id)
  where completed_at is null and request_id is not null;

comment on table public.loto_webhook_deliveries is
  'One row per outbound webhook attempt. Written by fire_webhooks(); response side filled in by reconcile_webhook_deliveries() called by /api/cron/webhook-reconcile.';

-- ──────────────────────────────────────────────────────────────────────
-- 2. Replace fire_webhooks() to write a delivery row per attempt
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.fire_webhooks(event_type text, payload jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = public, net
as $$
declare
  hook       record;
  body       jsonb;
  hdrs       jsonb;
  req_id     bigint;
  net_ok     boolean := exists (select 1 from pg_extension where extname = 'pg_net');
  pgcrypto_ok boolean := exists (select 1 from pg_extension where extname = 'pgcrypto');
  tenant_uuid uuid := nullif(payload->>'tenant_id', '')::uuid;
begin
  body := jsonb_build_object(
    'event',       event_type,
    'occurred_at', now(),
    'data',        payload
  );

  for hook in
    select id, name, url, secret
      from public.loto_webhook_subscriptions
     where active = true
       and events @> array[event_type]
  loop
    hdrs := jsonb_build_object(
      'Content-Type',          'application/json',
      'X-Soteria-Event',       event_type,
      'X-Soteria-Hook-Id',     hook.id::text,
      'X-Soteria-Hook-Name',   coalesce(hook.name, '')
    );
    if hook.secret is not null and pgcrypto_ok then
      hdrs := hdrs || jsonb_build_object(
        'X-Soteria-Signature',
        encode(hmac(body::text, hook.secret, 'sha256'), 'hex')
      );
    end if;

    req_id := null;
    if net_ok then
      -- net.http_post returns the request id as bigint. We capture it
      -- so the reconciler can join on it later.
      req_id := net.http_post(url := hook.url, headers := hdrs, body := body);
    end if;

    insert into public.loto_webhook_deliveries (
      tenant_id, subscription_id, subscription_name, subscription_url,
      event, payload, request_id,
      error
    ) values (
      tenant_uuid, hook.id, hook.name, hook.url,
      event_type, body, req_id,
      case when net_ok then null else 'pg_net extension not installed' end
    );
  end loop;
end $$;

comment on function public.fire_webhooks(text, jsonb) is
  'Fan out an event + record one loto_webhook_deliveries row per active matching subscription. No-op (still records a row with error=pg_net not installed) when pg_net is missing.';

-- ──────────────────────────────────────────────────────────────────────
-- 3. Reconciler — pulls completed responses from pg_net into our table
-- ──────────────────────────────────────────────────────────────────────
-- Returns the count of rows it patched. Designed for a cron loop:
-- call repeatedly with a small limit so a backlog drains gradually.
create or replace function public.reconcile_webhook_deliveries(limit_n int default 200)
  returns int
  language plpgsql
  security definer
  set search_path = public, net
as $$
declare
  patched int := 0;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 0;
  end if;

  with pending as (
    select id, request_id
      from public.loto_webhook_deliveries
     where completed_at is null
       and request_id is not null
     order by fired_at asc
     limit limit_n
  ),
  joined as (
    select
      p.id            as delivery_id,
      r.status_code   as status_code,
      r.content       as content,
      r.content_type  as content_type,
      r.headers       as headers,
      r.timed_out     as timed_out,
      r.error_msg     as error_msg,
      r.created       as created
      from pending p
      join net._http_response r on r.id = p.request_id
  ),
  upd as (
    update public.loto_webhook_deliveries d
       set response_status  = j.status_code,
           response_body    = case when j.content is not null
                                   then left(j.content, 4096)
                                   else null end,
           response_headers = j.headers,
           error            = case
                                when j.error_msg is not null then j.error_msg
                                when j.timed_out then 'pg_net timed out'
                                else null
                              end,
           duration_ms      = greatest(0, extract(epoch from (j.created - d.fired_at))::int * 1000),
           completed_at     = coalesce(j.created, now())
      from joined j
     where d.id = j.delivery_id
    returning 1
  )
  select count(*) into patched from upd;

  return patched;
end $$;

comment on function public.reconcile_webhook_deliveries(int) is
  'Patch loto_webhook_deliveries rows whose pg_net request has finished. Call from /api/cron/webhook-reconcile.';

-- ──────────────────────────────────────────────────────────────────────
-- 4. RLS — superadmin-only read, same posture as cron_runs.
--    Writes flow through fire_webhooks (SECURITY DEFINER) so we don't
--    need a write policy for normal users; the reconciler runs via the
--    service-role client which bypasses RLS entirely.
-- ──────────────────────────────────────────────────────────────────────
alter table public.loto_webhook_deliveries enable row level security;

drop policy if exists "webhook_deliveries_superadmin_read" on public.loto_webhook_deliveries;
create policy "webhook_deliveries_superadmin_read" on public.loto_webhook_deliveries
  for select to authenticated
  using (public.is_superadmin());

-- Tenant admins can also see their own tenant's deliveries — useful
-- when the customer's subscription stops working and their admin needs
-- to debug without superadmin involvement.
drop policy if exists "webhook_deliveries_tenant_admin_read" on public.loto_webhook_deliveries;
create policy "webhook_deliveries_tenant_admin_read" on public.loto_webhook_deliveries
  for select to authenticated
  using (
    tenant_id is not null
    and exists (
      select 1
        from public.tenant_memberships m
       where m.user_id = auth.uid()
         and m.tenant_id = loto_webhook_deliveries.tenant_id
         and m.role in ('owner', 'admin')
    )
  );

notify pgrst, 'reload schema';

commit;
