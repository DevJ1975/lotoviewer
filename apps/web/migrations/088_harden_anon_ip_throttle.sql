-- Migration 088: harden anon_report_ip_attempts + prune function exposure.
--
-- Follow-up to 085 prompted by Supabase get_advisors:
--   1. public.prune_anon_report_ip_attempts is exposed via PostgREST
--      RPC. SECURITY DEFINER + executable by anon means a remote
--      caller could trigger the prune. Revoke EXECUTE from anon and
--      authenticated; service_role and pg_cron retain access.
--   2. public.anon_report_ip_attempts has RLS enabled with no
--      explicit policy — that already denies authenticated/anon by
--      default, but the linter wants the intent stated. Add an
--      explicit deny-all policy + table comment.

begin;

revoke execute on function public.prune_anon_report_ip_attempts()
  from anon, authenticated, public;

drop policy if exists anon_ip_attempts_deny_all on public.anon_report_ip_attempts;
create policy anon_ip_attempts_deny_all on public.anon_report_ip_attempts
  for all to authenticated, anon
  using (false)
  with check (false);

comment on table public.anon_report_ip_attempts is
  'Hashed-IP attempt log for anonymous-report endpoints. Deny-all RLS by design — only service_role + cron read or write.';

notify pgrst, 'reload schema';

commit;
