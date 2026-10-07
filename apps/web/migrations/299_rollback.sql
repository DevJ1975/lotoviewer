-- Rollback for migration 299: environmental site profiles.
--
-- DESTRUCTIVE: dropping environmental_site_profiles discards every site's program
-- evaluation (what each facility said it is subject to). Export first if any
-- profile has been confirmed. The facilities.state check is dropped too; the
-- column and its values are untouched.
--
-- Idempotent.

begin;

drop table if exists public.environmental_site_profiles;
alter table public.facilities drop constraint if exists facilities_state_usps_check;

notify pgrst, 'reload schema';

commit;
