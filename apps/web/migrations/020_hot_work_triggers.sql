-- Migration 020: Hot Work webhook + push auto-triggers.
--
-- Two new triggers on loto_hot_work_permits, both reusing the
-- infrastructure shipped in earlier migrations:
--   • Webhook fan-out via public.fire_webhooks() from migration 013
--   • Web Push auto-dispatch via public.emit_push() from migration 018
--
-- Event mapping (fired in order on relevant transitions):
--
--   INSERT                                      → hot_work.created webhook
--   UPDATE pai_signature_at null→non-null       → hot_work.signed webhook
--   UPDATE work_completed_at null→non-null      → hot_work.work_complete webhook + push
--                                                 (push tells the watcher their post-watch
--                                                 timer just started)
--   UPDATE canceled_at null→non-null            → hot_work.canceled webhook
--                                                 + push when reason in
--                                                   ('fire_observed','unsafe_condition','expired')
--   UPDATE canceled_at + reason='fire_observed' → hot_work.fire_observed webhook (additional
--                                                 high-priority event so subscribers can route
--                                                 fire events to a dedicated channel)
--
-- Why push only fires on the safety-critical events: routine task_complete
-- close-outs are not emergencies. fire_observed / unsafe_condition / expired
-- ARE emergencies and warrant blasting every subscriber. work_complete is
-- a borderline case that we push because the fire watcher specifically
-- needs to know "your watch starts now" — without that ping they'd be
-- watching their wrist instead of the hot-work area.
--
-- Edge cases handled:
--   • Simultaneous work_completed_at + canceled_at in one UPDATE (admin
--     SQL fixup, backfill, etc.): the watch-started push is suppressed
--     when the row is also being canceled in the same statement —
--     telling a watcher "your watch starts now" while the permit is
--     being torn down would be worse than no notification at all.
--     Webhooks still fire faithfully for both transitions; subscribers
--     decide how to interpret them.
--   • Empty-string cancel_notes (vs NULL): coalesce alone doesn't catch
--     ''; we use nullif(notes, '') so a blank notes field falls through
--     to the "See permit detail." default rather than rendering as a
--     stranded trailing period in the push body.
--
-- Idempotent (`create or replace function` + `drop trigger if exists`).
-- Safe pre-pg_net — both fire_webhooks() and emit_push() no-op when
-- pg_net or org_config is missing.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Webhook trigger
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.hot_work_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fire_webhooks('hot_work.created', to_jsonb(NEW));
  elsif TG_OP = 'UPDATE' then
    -- Sign transition.
    if NEW.pai_signature_at is not null
       and OLD.pai_signature_at is null then
      perform public.fire_webhooks('hot_work.signed', to_jsonb(NEW));
    end if;
    -- Work-complete transition (starts post-watch period).
    if NEW.work_completed_at is not null
       and OLD.work_completed_at is null then
      perform public.fire_webhooks('hot_work.work_complete', to_jsonb(NEW));
    end if;
    -- Cancel transition. fire_observed gets BOTH the generic cancel
    -- event AND a dedicated fire_observed event so subscribers can
    -- subscribe to either or both depending on their routing rules
    -- (e.g. Slack #safety-fires only listens for fire_observed).
    if NEW.canceled_at is not null and OLD.canceled_at is null then
      perform public.fire_webhooks('hot_work.canceled', to_jsonb(NEW));
      if NEW.cancel_reason = 'fire_observed' then
        perform public.fire_webhooks('hot_work.fire_observed', to_jsonb(NEW));
      end if;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_hot_work_webhooks on public.loto_hot_work_permits;
create trigger trg_hot_work_webhooks
  after insert or update on public.loto_hot_work_permits
  for each row execute function public.hot_work_emit_webhooks();

comment on function public.hot_work_emit_webhooks() is
  'Fans out hot_work.* lifecycle events to webhook subscribers via fire_webhooks() (migration 013). No-op when pg_net is unavailable.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Push auto-trigger
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.hot_work_emit_push()
  returns trigger
  language plpgsql
  security definer
as $$
declare
  body_text text;
begin
  if TG_OP = 'UPDATE' then
    -- ── fire_observed: highest urgency. Push to ALL subscribers. ──────
    -- nullif(cancel_notes,'') so a blank notes field falls through to
    -- the default text rather than rendering as a stranded "<loc>. ".
    if NEW.canceled_at is not null and OLD.canceled_at is null
       and NEW.cancel_reason = 'fire_observed' then
      body_text := format(
        '%s at %s. %s',
        NEW.serial,
        NEW.work_location,
        coalesce(nullif(NEW.cancel_notes, ''), 'See permit detail.')
      );
      perform public.emit_push(jsonb_build_object(
        'title', 'FIRE OBSERVED — Hot work canceled',
        'body',  body_text,
        'url',   format('/hot-work/%s', NEW.id),
        'tag',   'hot_work:' || NEW.id || ':fire'
      ));
    -- ── unsafe_condition / expired: also push (matches the migration 018
    --    pattern for CS prohibited_condition / expired close-outs).
    elsif NEW.canceled_at is not null and OLD.canceled_at is null
          and NEW.cancel_reason in ('unsafe_condition','expired') then
      perform public.emit_push(jsonb_build_object(
        'title', case NEW.cancel_reason
                   when 'unsafe_condition' then 'Hot work canceled — unsafe condition'
                   when 'expired'          then 'Hot work expired — needs close-out'
                 end,
        'body',  format('%s at %s. %s',
                  NEW.serial,
                  NEW.work_location,
                  coalesce(nullif(NEW.cancel_notes, ''), 'See permit detail.')),
        'url',   format('/hot-work/%s', NEW.id),
        'tag',   'hot_work:' || NEW.id || ':canceled'
      ));
    end if;

    -- ── work_complete: tells the fire watcher their post-watch timer
    --    just started. Operational, but safety-critical (without this
    --    they'd miss the start of their watch).
    --
    -- Suppress when canceled_at is also set on NEW — a simultaneous
    -- work_complete + cancel UPDATE (admin fixup, backfill) shouldn't
    -- tell a watcher "your watch starts now" right as the permit is
    -- being torn down. Webhooks still fire for both transitions so
    -- the audit trail is faithful; only the human-facing push is
    -- suppressed in this pathological case.
    if NEW.work_completed_at is not null and OLD.work_completed_at is null
       and NEW.canceled_at is null then
      perform public.emit_push(jsonb_build_object(
        'title', 'Hot work complete — fire watch active',
        'body',  format('%s at %s — fire watch for %s minutes.',
                  NEW.serial,
                  NEW.work_location,
                  NEW.post_watch_minutes),
        'url',   format('/hot-work/%s', NEW.id),
        'tag',   'hot_work:' || NEW.id || ':watch_started'
      ));
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_hot_work_push on public.loto_hot_work_permits;
create trigger trg_hot_work_push
  after update on public.loto_hot_work_permits
  for each row execute function public.hot_work_emit_push();

comment on function public.hot_work_emit_push() is
  'Push auto-dispatch on safety-critical hot work transitions. Reuses emit_push() from migration 018 — same INTERNAL_PUSH_SECRET + push_dispatch_url config.';
