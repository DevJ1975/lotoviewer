-- Rollback for migration 300: environmental permits and outfalls.
--
-- DESTRUCTIVE: discards every recorded permit (dates, numbers, conditions) and
-- outfall. Export first if either has been filled in. Outfall checklist runs
-- keep their results (they reference outfalls only by a text subject id).
--
-- Idempotent.

begin;

drop table if exists public.stormwater_outfalls;
drop table if exists public.environmental_permits;

notify pgrst, 'reload schema';

commit;
