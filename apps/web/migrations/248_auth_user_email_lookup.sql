-- Migration 248: indexed auth-user lookup by email.
--
-- The invite routes need "does an auth.users row exist for this email?"
-- (repairing stale accounts whose profiles row was lost). They used to
-- answer it by paging admin.listUsers 200 rows at a time — an O(n) scan
-- capped at 10k users that was already flagged as a scale problem. This
-- function answers it with the unique email index GoTrue maintains.
--
-- SECURITY DEFINER + service_role-only execute: the function reads the
-- auth schema, which PostgREST does not expose. GoTrue stores emails
-- lowercased, and the app normalizes before calling, so the equality
-- match stays on the index.
--
-- Idempotent: re-runs are safe (create or replace).

begin;

create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
    from auth.users u
   where u.email = lower(p_email)
     and u.deleted_at is null
   limit 1
$$;

revoke all on function public.auth_user_id_by_email(text) from public;
revoke all on function public.auth_user_id_by_email(text) from anon;
revoke all on function public.auth_user_id_by_email(text) from authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

notify pgrst, 'reload schema';

commit;
