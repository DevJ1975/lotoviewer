-- Migration 050: extend loto_training_records.role enum with 'authorized_employee'.
--
-- The training-records table was originally added (migration 017) for
-- §1910.146(g) — confined spaces — and its CHECK constraint enumerated
-- only the four CS roles plus 'other'. Migration 019 added the two
-- hot-work roles via a separate alter (operator + fire_watcher).
--
-- LOTO §1910.147 calls the locktag-issued worker an "authorized
-- employee." Adding it as a first-class role lets the same training
-- table back the LOTO Devices checkout flow: when an admin checks out
-- a device to a worker, the same lookup-by-name pattern that gates
-- permit signing also gates the device handover.
--
-- The CHECK constraint is dropped + recreated since enum values can't
-- be added by alter-add for text-with-CHECK columns. Existing rows are
-- unaffected (the new value widens the set).

begin;

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
      'authorized_employee',
      'other'
    ));

notify pgrst, 'reload schema';

commit;
