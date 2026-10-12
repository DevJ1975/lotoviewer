-- Rollback for migration 318: environmental monitoring.
--
-- DESTRUCTIVE: discards every discharge limit and every sample result. A result is the
-- record of what a laboratory reported, and nothing else holds it. Export both tables first
-- if any have been filled in.
--
-- Stormwater outfalls (313), the permit vault (304) and everything EMS owns are NOT touched:
-- no outfall row is read or changed. The one change 318 made to stormwater_outfalls, its
-- same-site key, is removed last, after the tables that reference it are gone.
--
-- Run this before 313_rollback.sql: the tables dropped here reference stormwater_outfalls.
--
-- Idempotent.

begin;

drop table if exists public.monitoring_results;
drop table if exists public.monitoring_limits;

alter table if exists public.stormwater_outfalls
  drop constraint if exists stormwater_outfalls_tenant_facility_id_key;

notify pgrst, 'reload schema';

commit;
