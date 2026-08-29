-- Migration 261: record why fleet_motor_vehicle_incidents is kept.
--
-- The table has zero code references — no route, component, API handler,
-- core module or test reads or writes it. That reads as an orphan, and an
-- audit flagged it for deletion.
--
-- It is not an orphan. Migration 202 created it as declared Phase-1 schema
-- for Fleet Safety, and it is still wired into the surrounding machinery:
-- the RLS policy loop at 202_fleet_registers.sql:272 and the tenant index
-- at 241_scale_hardening_indexes.sql:47 both name it. Its `journey_id`
-- column is a soft reference to `fleet_journeys`, which migration 202's
-- own header schedules for Phase 3.
--
-- So the absence of code is a statement about how far the Fleet UI has
-- got, not evidence the table was abandoned. Dropping it would be an
-- irreversible migration taken on a misread — and would have to be undone
-- when the Fleet incident link is built.
--
-- This migration adds no schema. It writes the reasoning where the next
-- person to run that audit will find it: in the file, and in the database
-- catalog, so `\d+` and any schema browser answer the question too.

begin;

comment on table public.fleet_motor_vehicle_incidents is
  'Links a fleet vehicle/driver to an incident filed through the normal Incident Reporting lifecycle. Phase-1 schema from migration 202; no application code reads it yet because the Fleet incident-link UI is unbuilt. Intentionally retained — not an orphan. journey_id is a soft reference to fleet_journeys (Phase 3, not yet created).';

commit;
