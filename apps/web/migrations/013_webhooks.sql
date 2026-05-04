-- Migration 013: Outbound webhooks on permit + atmospheric-test lifecycle.
--
-- Why: every LOTO software comparison flags the same gap — the procedure
-- lives in one tool, the work order lives in another, and EHS lives in a
-- third. Big platforms (Cority, VelocityEHS) lean on heavy SOAP/REST APIs;
-- we undercut with simple HTTP-POST webhooks that pipe permit events into
-- Slack / Teams / a customer's BI stack with zero code on their side.
--
-- Implementation: a subscriptions table, a generic public.fire_webhooks
-- function, and AFTER triggers on the permit + test tables that classify
-- the change and call fire_webhooks with the right event name.
--
-- pg_net dependency: Supabase enables this extension by default for HTTP
-- from inside Postgres. If it's missing, fire_webhooks silently no-ops —
-- subscriptions still get created, nothing fires, and the user can run
-- `create extension pg_net;` later to switch them on. Triggers can't crash
-- the parent INSERT/UPDATE just because a webhook destination is down.
--
-- Idempotent: re-running this migration is safe (drops + recreates the
-- function bodies, idempotent table + trigger).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. loto_webhook_subscriptions — what URLs receive what events
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.loto_webhook_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  url         text not null,
  -- Optional shared secret. When present, fire_webhooks adds an
  -- X-Soteria-Signature header with HMAC-SHA256 of the body. Customers
  -- verify it to confirm the request really came from us. Skipped if
  -- pgcrypto isn't available; subscriptions still fire unsigned.
  secret      text,
  -- Subscribed event names. Any event not in this array is skipped.
  -- Known names today:
  --   permit.created, permit.signed, permit.canceled
  --   test.recorded, test.failed
  events      text[] not null default '{}',
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Reject malformed URLs at insert time. http(s):// only — no file://,
  -- no internal-only schemes that could be exploited from inside the DB.
  constraint webhook_url_http_only
    check (url ~* '^https?://')
);

create index if not exists idx_webhooks_active
  on public.loto_webhook_subscriptions(active)
  where active = true;

comment on table public.loto_webhook_subscriptions is
  'Outbound webhook destinations. Each subscription receives the events listed in `events[]` whenever fire_webhooks runs. URLs must be http(s)://.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. fire_webhooks(event_type, payload) — generic dispatcher
-- ────────────────────────────────────────────────────────────────────────────
-- security definer so a trigger can fan out events even when the row's RLS
-- policy wouldn't allow the originating user to read the subscriptions.
create or replace function public.fire_webhooks(event_type text, payload jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = public, net
as $$
declare
  hook   record;
  body   jsonb;
  hdrs   jsonb;
begin
  -- Soft-fail when pg_net isn't installed. This lets a Supabase project
  -- adopt webhook subscriptions before the extension is enabled, without
  -- the trigger taking down inserts/updates on the permit table.
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

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
    -- HMAC signature only when both pgcrypto is present and a secret is
    -- set — gracefully degrades to unsigned on older / leaner installs.
    if hook.secret is not null
       and exists (select 1 from pg_extension where extname = 'pgcrypto')
    then
      hdrs := hdrs || jsonb_build_object(
        'X-Soteria-Signature',
        encode(hmac(body::text, hook.secret, 'sha256'), 'hex')
      );
    end if;

    -- pg_net is non-blocking — the request goes onto an internal queue
    -- and is sent asynchronously. The parent transaction commits without
    -- waiting; webhook delivery latency never affects user-perceived
    -- save time. Errors during HTTP delivery don't propagate back here.
    perform net.http_post(url := hook.url, headers := hdrs, body := body);
  end loop;
end $$;

comment on function public.fire_webhooks(text, jsonb) is
  'Fan out an event to every active subscription that includes event_type in its events[] array. No-op if pg_net is not enabled.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Permit lifecycle trigger
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.permits_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fire_webhooks('permit.created', to_jsonb(NEW));
  elsif TG_OP = 'UPDATE' then
    -- Sign transition: signature_at went from null to a timestamp.
    if NEW.entry_supervisor_signature_at is not null
       and OLD.entry_supervisor_signature_at is null then
      perform public.fire_webhooks('permit.signed', to_jsonb(NEW));
    end if;
    -- Cancel transition.
    if NEW.canceled_at is not null and OLD.canceled_at is null then
      perform public.fire_webhooks('permit.canceled', to_jsonb(NEW));
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_permits_webhooks on public.loto_confined_space_permits;
create trigger trg_permits_webhooks
  after insert or update on public.loto_confined_space_permits
  for each row execute function public.permits_emit_webhooks();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Atmospheric-test trigger — test.recorded always; test.failed when any
--    OSHA-default channel is exceeded.
-- ────────────────────────────────────────────────────────────────────────────
-- We hard-code OSHA defaults here rather than reading the per-permit
-- override. The override lives in jsonb on the permit row; reading it
-- inside a trigger requires another SELECT and complicates failure
-- semantics. Customers wanting per-permit-override-aware webhooks can
-- consume test.recorded and run their own evaluation.
create or replace function public.tests_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  perform public.fire_webhooks('test.recorded', to_jsonb(NEW));
  if (NEW.o2_pct  is not null and (NEW.o2_pct  < 19.5 or NEW.o2_pct > 23.5))
     or (NEW.lel_pct is not null and NEW.lel_pct > 10)
     or (NEW.h2s_ppm is not null and NEW.h2s_ppm > 10)
     or (NEW.co_ppm  is not null and NEW.co_ppm  > 35)
  then
    perform public.fire_webhooks('test.failed', to_jsonb(NEW));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_tests_webhooks on public.loto_atmospheric_tests;
create trigger trg_tests_webhooks
  after insert on public.loto_atmospheric_tests
  for each row execute function public.tests_emit_webhooks();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS — subscriptions are admin-only because they can exfiltrate data
--    (the payload contains permit + test rows). Non-admin authenticated
--    users get no read or write.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_webhook_subscriptions enable row level security;

drop policy if exists "loto_webhook_subscriptions_admin_only" on public.loto_webhook_subscriptions;
create policy "loto_webhook_subscriptions_admin_only" on public.loto_webhook_subscriptions
  for all
  using ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) )
  with check ( exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true) );

-- Audit trigger so subscription changes show up on /admin/audit alongside
-- everything else.
drop trigger if exists trg_audit_loto_webhook_subscriptions on public.loto_webhook_subscriptions;
create trigger trg_audit_loto_webhook_subscriptions
  after insert or update or delete on public.loto_webhook_subscriptions
  for each row execute function public.log_audit('id');
