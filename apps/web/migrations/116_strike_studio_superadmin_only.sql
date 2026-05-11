-- Migration 116: Lock STRIKE Studio requests to superadmins only.
--
-- The tenant-facing STRIKE page is learner/admin operations only:
-- published courses, assignments, requirements, and readiness checks.
-- Course production belongs in the superadmin Studio workflow, so the
-- legacy request table must not be readable or writable by tenant users.

begin;

drop policy if exists strike_studio_requests_read on public.strike_studio_requests;
create policy strike_studio_requests_read on public.strike_studio_requests
  for select to authenticated
  using (public.is_superadmin());

drop policy if exists strike_studio_requests_write on public.strike_studio_requests;
create policy strike_studio_requests_write on public.strike_studio_requests
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
