-- Rollback for migration 303: withdraw the v1.20.0 release note.
--
-- Removes only the row 303 published (no author), so a note an admin wrote
-- by hand for the same version stays.
--
-- Apply: paste into the SQL Editor, or run with psql.

begin;

delete from public.release_notes
 where version = 'v1.20.0'
   and created_by is null;

commit;
