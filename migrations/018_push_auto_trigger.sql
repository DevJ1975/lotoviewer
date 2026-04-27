-- Migration 018: Auto-fire Web Push notifications from Postgres triggers
-- on the highest-urgency lifecycle events.
--
-- Why: the existing /api/push/dispatch endpoint is admin-callable for
-- "Send a test push," but production alerts need to fire without a
-- human in the loop. A failing atmospheric reading or a permit canceled
-- for prohibited-condition both warrant pushing every subscribed device
-- immediately.
--
-- Mechanism (mirrors the webhook dispatcher from migration 013):
--   1. Add push_dispatch_url + push_dispatch_secret to loto_org_config.
--      The trigger reads them at fire time. Null URL → no-op (lets a
--      Supabase project apply the migration before configuration is
--      done; the trigger fails closed silently).
--   2. emit_push(payload jsonb) builds the dispatch HTTP request and
--      sends via pg_net.http_post with X-Internal-Secret matching the
--      API route's INTERNAL_PUSH_SECRET env var.
--   3. AFTER triggers on permits + atmospheric_tests build a clean
--      PushPayload {title, body, url, tag} per event and call emit_push.
--
-- Idempotent. Safe pre-pg_net (the function checks for the extension).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Config columns on the singleton org_config row
-- ────────────────────────────────────────────────────────────────────────────
alter table public.loto_org_config
  add column if not exists push_dispatch_url    text,
  add column if not exists push_dispatch_secret text;

comment on column public.loto_org_config.push_dispatch_url is
  'Full URL to /api/push/dispatch on the deployed app. Null disables auto-dispatch.';
comment on column public.loto_org_config.push_dispatch_secret is
  'Shared secret matching env INTERNAL_PUSH_SECRET on the API side. Sent as X-Internal-Secret header.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Generic dispatcher — same shape as fire_webhooks but routes to the
--    push dispatch endpoint instead of arbitrary subscriber URLs.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.emit_push(payload jsonb)
  returns void
  language plpgsql
  security definer
  set search_path = public, net
as $$
declare
  cfg record;
begin
  -- pg_net is the only mechanism for outbound HTTP from Postgres. If
  -- it isn't installed (some self-hosted Supabase variants), we no-op
  -- rather than blocking the parent INSERT/UPDATE.
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select push_dispatch_url, push_dispatch_secret
    into cfg
    from public.loto_org_config
   where id = 1;

  -- Both URL and secret must be set for the dispatch to fire. Either
  -- being null means the operator hasn't finished configuring auto-
  -- push yet — we silently skip rather than failing the parent action.
  if cfg.push_dispatch_url is null or cfg.push_dispatch_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := cfg.push_dispatch_url,
    headers := jsonb_build_object(
      'Content-Type',       'application/json',
      'X-Internal-Secret',  cfg.push_dispatch_secret
    ),
    body    := payload
  );
end $$;

comment on function public.emit_push(jsonb) is
  'Auto-dispatch a Web Push notification via pg_net. No-op if pg_net is missing or org_config is unconfigured.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: failing atmospheric test → push every subscriber.
--    This is the highest-urgency event in the system — a fail means
--    entrants must evacuate immediately per §1910.146(e)(5)(ii).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.tests_emit_push()
  returns trigger
  language plpgsql
  security definer
as $$
declare
  serial   text;
  space_id text;
  channels text[] := array[]::text[];
begin
  -- Match the channel-fail definition used by the webhook dispatcher
  -- (migration 013) so the two systems agree on what "failed" means.
  if not (
    (NEW.o2_pct  is not null and (NEW.o2_pct  < 19.5 or NEW.o2_pct > 23.5))
     or (NEW.lel_pct is not null and NEW.lel_pct > 10)
     or (NEW.h2s_ppm is not null and NEW.h2s_ppm > 10)
     or (NEW.co_ppm  is not null and NEW.co_ppm  > 35)
  ) then
    return NEW;  -- passing reading — no push
  end if;

  if NEW.o2_pct  is not null and (NEW.o2_pct  < 19.5 or NEW.o2_pct > 23.5) then
    channels := array_append(channels, 'O2');
  end if;
  if NEW.lel_pct is not null and NEW.lel_pct > 10 then channels := array_append(channels, 'LEL'); end if;
  if NEW.h2s_ppm is not null and NEW.h2s_ppm > 10 then channels := array_append(channels, 'H2S'); end if;
  if NEW.co_ppm  is not null and NEW.co_ppm  > 35 then channels := array_append(channels, 'CO');  end if;

  -- Look up the permit's serial + space for a useful notification
  -- title. Cheap point-lookup on the indexed PK.
  select p.serial, p.space_id
    into serial, space_id
    from public.loto_confined_space_permits p
   where p.id = NEW.permit_id;

  perform public.emit_push(jsonb_build_object(
    'title', 'Atmospheric reading FAILED',
    'body',  format('%s on %s — %s out of range. Evacuate per §(e)(5)(ii).',
               coalesce(serial, 'permit'),
               coalesce(space_id, '?'),
               array_to_string(channels, ', ')),
    'url',   format('/confined-spaces/%s/permits/%s', coalesce(space_id, ''), NEW.permit_id),
    -- Tag dedupes on iOS/Android: multiple fails on the same permit
    -- collapse to the latest notification rather than stacking.
    'tag',   'permit:' || NEW.permit_id || ':fail'
  ));
  return NEW;
end $$;

drop trigger if exists trg_tests_emit_push on public.loto_atmospheric_tests;
create trigger trg_tests_emit_push
  after insert on public.loto_atmospheric_tests
  for each row execute function public.tests_emit_push();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: prohibited-condition cancellation → push every subscriber.
--    A canceled-for-cause permit means something went wrong; everyone
--    needs to know immediately. Routine task_complete cancels do NOT
--    push (they're normal close-outs, not alerts).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.permits_emit_push()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.canceled_at is not null
     and OLD.canceled_at is null
     and NEW.cancel_reason in ('prohibited_condition', 'expired') then
    perform public.emit_push(jsonb_build_object(
      'title', case NEW.cancel_reason
                 when 'prohibited_condition' then 'Permit CANCELED — prohibited condition'
                 when 'expired'              then 'Permit closed — past expiration'
               end,
      'body',  format('%s on %s. %s',
                 coalesce(NEW.serial, 'permit'),
                 NEW.space_id,
                 coalesce(NEW.cancel_notes, 'See permit detail.')),
      'url',   format('/confined-spaces/%s/permits/%s', NEW.space_id, NEW.id),
      'tag',   'permit:' || NEW.id || ':canceled'
    ));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_permits_emit_push on public.loto_confined_space_permits;
create trigger trg_permits_emit_push
  after update on public.loto_confined_space_permits
  for each row execute function public.permits_emit_push();
