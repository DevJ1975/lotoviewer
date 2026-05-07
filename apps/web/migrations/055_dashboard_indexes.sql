-- Migration 055: dashboard / cron time-range indexes.
--
-- Three queries shipped this session do `WHERE <ts_column> >= since`
-- without a leading-column user_id / tenant_id, so the existing
-- compound indexes (e.g. idx_ai_invocations_user_recent on
-- (user_id, surface, occurred_at desc)) can't be used. At small
-- scale Postgres falls back to a sequential scan and it's fine; at
-- 100k+ rows the dashboard pages and the training-expiry cron get
-- noticeably slow.
--
-- All three indexes are descending so ORDER BY <ts> DESC LIMIT N
-- can short-circuit. The training-expiry index is partial — we
-- only ever care about non-null expires_at, and most historical
-- training records have one — so the filtered btree is tighter.

begin;

-- ai_invocations.occurred_at — used by /api/superadmin/ai-usage
-- (cross-tenant scan) and would also accelerate any future
-- per-day rollup cron.
create index if not exists idx_ai_invocations_occurred_at
  on public.ai_invocations(occurred_at desc);

-- support_tickets.created_at — used by /api/superadmin/support-metrics
-- for the windowed scan that feeds the dashboard tiles.
create index if not exists idx_support_tickets_created_at
  on public.support_tickets(created_at desc);

-- loto_training_records.expires_at — used by the
-- /api/cron/training-expiry-reminders daily cron's window query
-- (after a follow-up patch that adds an explicit
-- gte('expires_at', today - 7d) filter).
create index if not exists idx_loto_training_records_expires_at
  on public.loto_training_records(expires_at)
  where expires_at is not null;

notify pgrst, 'reload schema';

commit;
