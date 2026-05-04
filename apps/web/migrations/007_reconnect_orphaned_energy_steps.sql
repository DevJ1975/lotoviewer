-- Migration 007: Reconnect orphaned loto_energy_steps rows to their
-- correct loto_equipment parent.
--
-- Symptom: ~10% of placards show "No energy steps defined for this
-- equipment" even though the steps were migrated in and 90% of
-- placards do render correctly. Cause is an equipment_id mismatch
-- between the value stored on loto_energy_steps and the canonical
-- value on loto_equipment — typically trailing whitespace or case
-- differences introduced by the import.
--
-- The fetch code matches equipment_id with strict string equality
-- (see components/dashboard/PlacardDetailPanel.tsx and the other
-- read paths), so 'PT-123 ' and 'PT-123' never match, and neither
-- do 'pt-123' and 'PT-123'.
--
-- This migration only fixes rows where the correct parent is
-- UNAMBIGUOUS:
--   Pass 1 — whitespace-only mismatch: btrim() both sides and match
--            (safe; trimming can't create new collisions in practice)
--   Pass 2 — case + whitespace mismatch: lower(btrim()) both sides,
--            but only when exactly one loto_equipment row matches
--            the normalized form (ambiguity guard prevents reassigning
--            steps to the wrong parent when two equipment items
--            differ only in case)
--
-- Rows with no match or with ambiguous matches are left alone and
-- surfaced via RAISE NOTICE for manual review.
--
-- Idempotent — once ids are canonical, re-running is a no-op (the
-- `s.equipment_id <> e.equipment_id` guard rejects rows that already
-- match).

-- 1. Report orphaned rows BEFORE the fix so the deltas are obvious in
--    the SQL editor output.
do $$
declare
  orphaned int;
begin
  select count(*) into orphaned
    from public.loto_energy_steps s
   where not exists (
     select 1 from public.loto_equipment e
      where e.equipment_id = s.equipment_id
   );
  raise notice '[007] orphaned energy_steps BEFORE fix: %', orphaned;
end $$;

-- 2. Whitespace-only fix (the common case — leading/trailing spaces
--    from CSV imports or hand-typed ids).
update public.loto_energy_steps s
   set equipment_id = e.equipment_id
  from public.loto_equipment e
 where s.equipment_id <> e.equipment_id
   and btrim(s.equipment_id) = e.equipment_id
   -- Also guards against the step's current id already matching a
   -- different, real parent — only fix rows that are actually orphaned.
   and not exists (
     select 1 from public.loto_equipment e2
      where e2.equipment_id = s.equipment_id
   );

-- 3. Case + whitespace fix, with ambiguity guard. Only update when
--    exactly one canonical loto_equipment row matches the normalized
--    (lower + trimmed) form — otherwise leave the row alone and let
--    a human pick the correct parent.
update public.loto_energy_steps s
   set equipment_id = (
     select e.equipment_id
       from public.loto_equipment e
      where lower(btrim(e.equipment_id)) = lower(btrim(s.equipment_id))
      limit 1
   )
 where not exists (
   select 1 from public.loto_equipment e
    where e.equipment_id = s.equipment_id
 )
   and (
     select count(*) from public.loto_equipment e
      where lower(btrim(e.equipment_id)) = lower(btrim(s.equipment_id))
   ) = 1;

-- 4. Report what's still orphaned AFTER the fix, so any remaining
--    mismatches (prefix differences, separator swaps, completely
--    unrelated ids) can be reviewed manually.
do $$
declare
  orphaned int;
begin
  select count(*) into orphaned
    from public.loto_energy_steps s
   where not exists (
     select 1 from public.loto_equipment e
      where e.equipment_id = s.equipment_id
   );
  raise notice '[007] orphaned energy_steps AFTER fix: %', orphaned;
  if orphaned > 0 then
    raise notice '[007] remaining orphans need manual review — run:';
    raise notice '  select distinct s.equipment_id';
    raise notice '    from loto_energy_steps s';
    raise notice '   where not exists (select 1 from loto_equipment e';
    raise notice '                      where e.equipment_id = s.equipment_id);';
  end if;
end $$;
