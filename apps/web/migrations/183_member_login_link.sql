-- Migration 183: One-login-per-tenant invariant for members.
--
-- The members table already carries `unique (tenant_id, profile_id)`
-- from migration 131. That table-level constraint treats NULL as
-- distinct, so it doesn't constrain roster-only members but does
-- enforce one-member-per-profile. This migration adds an explicit
-- partial unique index that documents intent, mirrors the WHERE
-- clause used in queries, and gives the planner a smaller index to
-- consult.
--
-- Before creating it we hand-check for any pre-existing duplicates.
-- A bare CREATE UNIQUE INDEX would error with a generic message; the
-- pre-check raises EXCEPTION naming the offending rows so the operator
-- knows what to clean up.

begin;

do $$
declare
  v_dupes record;
  v_msg text := '';
begin
  for v_dupes in
    select tenant_id, profile_id, count(*) as n,
           array_agg(id order by created_at) as member_ids
      from public.members
     where profile_id is not null
     group by tenant_id, profile_id
    having count(*) > 1
  loop
    v_msg := v_msg
      || format(E'\n  tenant=%s profile=%s rows=%s ids=%s',
                v_dupes.tenant_id, v_dupes.profile_id, v_dupes.n, v_dupes.member_ids);
  end loop;

  if v_msg <> '' then
    raise exception
      'members has duplicate (tenant_id, profile_id) rows; merge them via merge_members() before applying 183:%',
      v_msg;
  end if;
end;
$$;

create unique index if not exists members_tenant_profile_unique
  on public.members (tenant_id, profile_id)
  where profile_id is not null;

commit;
