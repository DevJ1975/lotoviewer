-- Migration 242: retention jobs for high-churn operational tables (Phase 0).
-- See docs/audits/scale-audit-6500-users.md.
--
-- audit_log and cron_runs grow unbounded with no pruning (cron_runs' own migration
-- 056 notes "a tiny pruning cron ... isn't included here"). At 6,500 users audit_log
-- trends to ~8-10 GB/yr on a single heap. These pg_cron jobs cap both, mirroring the
-- existing prune-anon-report-ip-attempts job (cron.job id 1).
--
-- Idempotent: unschedule any existing job of the same name, then (re)schedule.
-- Run via the pg_cron extension (not wrapped in an explicit transaction).

select cron.unschedule(jobid) from cron.job where jobname = 'prune-cron-runs';
select cron.schedule(
  'prune-cron-runs',
  '30 3 * * *',
  $$ delete from public.cron_runs where started_at < now() - interval '30 days' $$
);

select cron.unschedule(jobid) from cron.job where jobname = 'prune-audit-log';
select cron.schedule(
  'prune-audit-log',
  '45 3 * * *',
  $$ delete from public.audit_log where created_at < now() - interval '12 months' $$
);
