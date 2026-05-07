-- Migration 056: cron_runs — observability for scheduled jobs.
--
-- The Vercel scheduler fires our crons (vercel.json) but doesn't
-- expose history through any API the app can hit. Today the only
-- way to know "did the training-expiry cron run today?" is dig
-- through Sentry or the Vercel logs UI. This migration adds an
-- in-DB run log that each cron writes to via supabaseAdmin (RLS-
-- bypassing service role).
--
-- The /superadmin/cron dashboard reads these rows to surface:
--   - last fired timestamp per cron
--   - last status (running / success / error)
--   - run duration
--   - summary text (e.g., "archived 3 tickets" or "tenants_scanned: 5")
--
-- Rows are append-only (each invocation = one row); a tiny pruning
-- cron can age out >90 day rows if needed but isn't included here.

begin;

create table if not exists public.cron_runs (
  id          bigserial primary key,
  -- The route path this row is for. Free-form text so future crons
  -- don't need a migration. Examples:
  --   /api/cron/training-expiry-reminders
  --   /api/cron/archive-resolved-tickets
  cron_path   text not null,
  started_at  timestamptz not null default now(),
  -- ended_at + status are NULL for in-flight runs; set when the
  -- cron's request handler returns (success branch) or catches
  -- (error branch). A row that stays NULL forever past its
  -- expected duration means the cron crashed mid-run.
  ended_at    timestamptz,
  status      text check (status in ('running', 'success', 'error')) default 'running',
  -- One-line summary the cron supplies. e.g. for the archive cron:
  -- "archived: 5, cutoff: 2026-04-06". Displayed inline in the
  -- dashboard table so an operator gets context without clicking.
  summary     text,
  -- Trigger source for audit + debugging. 'scheduled' is the
  -- normal Vercel-cron path; 'manual' is a superadmin pressing
  -- the run-now button.
  trigger     text not null default 'scheduled' check (trigger in ('scheduled', 'manual')),
  -- Who ran a manual trigger. NULL for scheduled invocations.
  triggered_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_cron_runs_path_recent
  on public.cron_runs(cron_path, started_at desc);

create index if not exists idx_cron_runs_recent
  on public.cron_runs(started_at desc);

comment on table public.cron_runs is
  'Per-invocation log of /api/cron/* routes. Written by lib/cronInstrumentation.ts via service-role; read by /superadmin/cron dashboard.';

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — superadmins read; nobody else needs visibility here. Writes
-- come from the service role (cron handlers + manual-run route)
-- which bypasses RLS entirely.
-- ──────────────────────────────────────────────────────────────────────────
alter table public.cron_runs enable row level security;

drop policy if exists "cron_runs_superadmin_read" on public.cron_runs;
create policy "cron_runs_superadmin_read" on public.cron_runs
  for select to authenticated
  using (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
