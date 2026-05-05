-- Migration 048: support_tickets.archived_at + retention split.
--
-- Adds a third lifecycle state on top of the existing open / resolved
-- pair so resolved tickets can be hidden from the active triage view
-- without losing the audit trail.
--
-- Lifecycle:
--   open      → resolved_at IS NULL                                    (active triage)
--   resolved  → resolved_at IS NOT NULL AND archived_at IS NULL        (recent close-outs, ≤ 30 days)
--   archived  → archived_at IS NOT NULL                                (cold storage; auto-set by cron)
--
-- The cron at /api/cron/archive-resolved-tickets runs daily and sets
-- archived_at = now() on every row with resolved_at < now() - 30 days
-- and archived_at IS NULL. No app path mutates archived_at.
--
-- Indexes are partial so they stay tiny — only the rows that are
-- actually candidates for each filter view land in each index.

begin;

alter table public.support_tickets
  add column if not exists archived_at timestamptz;

-- Hot-path index for the cron's "rows ready to archive" lookup.
create index if not exists idx_support_tickets_archive_candidates
  on public.support_tickets (resolved_at)
  where resolved_at is not null and archived_at is null;

-- Hot-path index for the "Archive" tab on /superadmin/support.
create index if not exists idx_support_tickets_archived
  on public.support_tickets (archived_at desc)
  where archived_at is not null;

-- Drop + replace the partial open index so it explicitly excludes
-- archived rows. archived rows already have resolved_at set so they
-- weren't in this index anyway, but the predicate makes intent clear
-- to anyone reading the schema.
drop index if exists public.idx_support_tickets_open;
create index if not exists idx_support_tickets_open
  on public.support_tickets (created_at desc)
  where resolved_at is null and archived_at is null;

notify pgrst, 'reload schema';

commit;
