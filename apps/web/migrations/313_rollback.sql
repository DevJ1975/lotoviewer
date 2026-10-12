-- Rollback for migration 313: stormwater outfalls.
--
-- DESTRUCTIVE: discards every recorded outfall. Export first if any have been
-- filled in. Outfall checklist runs keep their results (they reference outfalls
-- only by a text subject id).
--
-- environmental_permits is the permit vault's table (migration 304) and is NOT
-- touched here; only the site-scoped unique key this migration added to it is
-- removed, after the table that depends on it is gone.
--
-- Idempotent.

begin;

drop table if exists public.stormwater_outfalls;

alter table if exists public.environmental_permits
  drop constraint if exists environmental_permits_tenant_facility_id_key;

notify pgrst, 'reload schema';

commit;
