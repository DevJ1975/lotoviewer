-- Migration 025: bump-test reminder dedup.
--
-- The /api/cron/meter-bump-reminders endpoint fires push notifications
-- when a 4-gas meter is approaching or past its 24h bump-test window.
-- It runs on a schedule (Vercel Cron / pg_cron / external cron — whichever
-- the deployment uses) so without dedup it would re-fire every tick.
--
-- This table records "we sent an alert for instrument X at time T". The
-- API only fires when no recent alert exists for the instrument, which
-- spaces reminders out by a configurable window (12h by default).
--
-- We don't FK instrument_id to loto_gas_meters because the existing
-- patterns elsewhere already accept free-text instrument IDs that may
-- not be in the register; staying consistent here means a meter that
-- hasn't been added to the register can still have an alert recorded
-- (rare but possible if e.g. the meter is referenced by an atmospheric
-- test before it's registered).
--
-- Idempotent — re-running this migration is a no-op.

create table if not exists public.loto_meter_alerts (
  id              uuid primary key default gen_random_uuid(),
  instrument_id   text not null,
  -- 'overdue'   = bump-test window expired (>24h since last bump)
  -- 'never'     = meter exists but has never been bumped
  alert_kind      text not null check (alert_kind in ('overdue', 'never')),
  -- Most recent push that went out for this instrument. We index this
  -- DESC so the dedup query "is there an alert in the last N hours?"
  -- hits the index head.
  sent_at         timestamptz not null default now(),
  -- How many subscriptions received the push. Best-effort instrumentation
  -- — the cron API records it for ops visibility but doesn't act on it.
  recipients      int not null default 0
);

create index if not exists idx_meter_alerts_recent
  on public.loto_meter_alerts(instrument_id, sent_at desc);

-- RLS — admins read, service role writes via the cron route. Same shape
-- as loto_audit_log (admin-readable, machine-written).
alter table public.loto_meter_alerts enable row level security;

drop policy if exists "loto_meter_alerts_admin_read" on public.loto_meter_alerts;
create policy "loto_meter_alerts_admin_read" on public.loto_meter_alerts
  for select to authenticated
  using (exists (
    select 1 from public.profiles
     where id = auth.uid() and is_admin = true
  ));

-- Pruning: alerts older than 30 days are retention-safe to drop. We
-- don't add a job to do that here — it's a one-line manual command if
-- the table grows ("delete from loto_meter_alerts where sent_at < now() - interval '30 days'")
-- and the cron route already only reads the recent slice via the
-- (instrument_id, sent_at desc) index.

comment on table public.loto_meter_alerts is
  'Dedup record for bump-test reminder pushes. /api/cron/meter-bump-reminders writes one row per push fan-out and skips an instrument when a recent row already exists.';
