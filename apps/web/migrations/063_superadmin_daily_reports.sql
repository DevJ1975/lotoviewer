-- Migration 063: superadmin_daily_reports — morning health narrative.
--
-- Replaces the daily ritual of opening 5 dashboards (cron, AI usage,
-- support, webhooks, audit) with a single email + page card. Cron
-- /api/cron/superadmin-daily-report runs at 12:00 UTC, aggregates
-- the last 24h, asks Sonnet to synthesize, and stores the result
-- here so the regenerate button + history view have something to
-- read.
--
-- One row per `for_date` (UTC date, unique). Re-running the cron
-- the same day is idempotent — the upsert overwrites with a fresh
-- generated_at and re-sends the email if delivered_at is null.

begin;

create table if not exists public.superadmin_daily_reports (
  id            bigserial primary key,
  -- Date this report covers (the 24h ending at midnight UTC of for_date).
  for_date      date not null unique,
  -- When the cron actually generated this row. Distinct from for_date
  -- because a manual regenerate updates this field on the same date row.
  generated_at  timestamptz not null default now(),
  -- AI-authored synthesis. Empty when the model errored (cron stores
  -- a hand-written fallback; the column is non-null to keep the read
  -- path simple).
  narrative     text not null,
  -- Bullets the model surfaced as anomalies. Empty array if nothing.
  anomalies     text[] not null default '{}',
  -- Raw aggregation inputs for audit + debug. Operators can scroll
  -- back and verify "did the model see what I see now?".
  metrics       jsonb not null,
  model         text not null,
  -- Set when the morning email actually went out. Null = email not
  -- yet sent (regenerate after the cron sends nothing extra unless
  -- this is reset).
  delivered_at  timestamptz
);

create index if not exists idx_superadmin_daily_reports_recent
  on public.superadmin_daily_reports (for_date desc);

comment on table public.superadmin_daily_reports is
  'Morning multi-tenant health narrative + anomaly bullets. Written by /api/cron/superadmin-daily-report; surfaced at /superadmin/daily-report.';

-- ──────────────────────────────────────────────────────────────────────
-- RLS — superadmin only.
-- ──────────────────────────────────────────────────────────────────────
alter table public.superadmin_daily_reports enable row level security;

drop policy if exists "superadmin_daily_reports_superadmin_read" on public.superadmin_daily_reports;
create policy "superadmin_daily_reports_superadmin_read"
  on public.superadmin_daily_reports for select to authenticated
  using (public.is_superadmin());

-- No insert/update policy: the cron writes via service role.

notify pgrst, 'reload schema';

commit;
