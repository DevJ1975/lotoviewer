-- Migration 021: Extend loto_training_records.role CHECK to accept the
-- two hot-work training roles introduced by migration 019.
--
-- Why this is a separate migration: 019 added 'hot_work_operator' and
-- 'fire_watcher' to the TypeScript TrainingRole union (lib/types.ts) but
-- the CHECK constraint on loto_training_records.role still only allows
-- the original five values from migration 017. Any attempt to insert a
-- hot-work training record from the admin UI fails the CHECK. This
-- migration brings the DB constraint in line with the application code
-- so the hot-work sign-gate's training validation works against real
-- data.
--
-- Pattern: drop the existing CHECK by name (added inline in 017) and
-- re-add with the expanded value list. Idempotent — re-running drops
-- the new CHECK and re-adds the same one.

-- The original CHECK was inlined on the column; PostgreSQL auto-named
-- it loto_training_records_role_check. Use that name to drop.
alter table public.loto_training_records
  drop constraint if exists loto_training_records_role_check;

alter table public.loto_training_records
  add constraint loto_training_records_role_check
  check (role in (
    'entrant',
    'attendant',
    'entry_supervisor',
    'rescuer',
    'hot_work_operator',
    'fire_watcher',
    'other'
  ));

comment on constraint loto_training_records_role_check on public.loto_training_records is
  'Allowed values for the role column. Mirrors the TrainingRole TS union in lib/types.ts. Extended in migration 021 to include hot_work_operator and fire_watcher (per migration 019).';
