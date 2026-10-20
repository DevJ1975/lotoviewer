-- Migration 303: the permit training gate checks every requirement on its
-- own terms, and learners can see department and site assignments.
--
-- 1. permit_training_status (last recreated in 302) grouped completions by
--    (member, module). Two requirements on the same module, say a
--    tenant-wide one and a stricter permit-specific one with a 90-day
--    window, were merged: a pass satisfying the looser one made both
--    'current', so the stricter one was never enforced, and every row came
--    back twice. Completions are now grouped by requirement.
--
-- 2. Its members joins did not name the tenant. p_extra_member_ids comes
--    from the caller, so any member id, from any tenant, came back with its
--    display_name. The joins now require the member to be in p_tenant_id.
--
-- 3. strike_assignments_read let a learner see tenant, user, member and
--    role assignments but not department or site ones, which the app
--    (isStrikeAssignmentApplicable) applies to them: a worker assigned
--    through their department never saw the assignment on /strike. The
--    policy keeps every clause it has in production, including 'member',
--    and adds those two, matched as the app does (trimmed, case-blind).
--
-- Idempotent.

begin;

create or replace function public.permit_training_status(
  p_tenant_id        uuid,
  p_permit_type      text,
  p_permit_id        uuid,
  p_extra_member_ids uuid[] default '{}'
)
returns table (
  member_id    uuid,
  display_name text,
  module_id    uuid,
  module_title text,
  status       text,
  expires_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Security definer reads other people's completions, so an end-user
  -- caller must belong to the tenant. Trigger and service-role contexts
  -- carry no end-user role claim and pass straight through.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon')
     and not (p_tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  then
    raise exception 'Not a member of this tenant' using errcode = 'insufficient_privilege';
  end if;

  return query
  with reqs as (
    select r.id, r.module_id, r.module_version_id, r.expires_after_days, m.title
      from public.strike_training_requirements r
      join public.strike_modules m on m.id = r.module_id
     where r.tenant_id = p_tenant_id
       and r.active
       and r.required_before_start
       and r.source_type = public.permit_requirement_source(p_permit_type)
       and (r.source_id is null or r.source_id = p_permit_id)
  ),
  crew as (
    select pw.member_id
      from public.permit_workers pw
     where pw.tenant_id = p_tenant_id and pw.permit_type = p_permit_type and pw.permit_id = p_permit_id
    union
    select x.member_id from unnest(p_extra_member_ids) as x(member_id) where x.member_id is not null
  ),
  overridden as (
    select distinct x.member_id
      from public.permit_training_overrides o, unnest(o.member_ids) as x(member_id)
     where o.tenant_id = p_tenant_id and o.permit_type = p_permit_type and o.permit_id = p_permit_id
  ),
  floors as (
    select v.module_id,
           coalesce(max(v.version_number) filter (where v.supersedes_completions), 1) as floor
      from public.strike_module_versions v
     where v.status in ('published', 'superseded')
     group by v.module_id
  ),
  best as (
    select c.member_id, r.id as requirement_id, max(sc.expires_at) as expires_at, count(sc.id) as passes,
           bool_or(sc.expires_at is null) as never_expires
      from crew c
      cross join reqs r
      join public.members mem on mem.id = c.member_id and mem.tenant_id = p_tenant_id
      left join public.strike_completions sc
        on sc.tenant_id = p_tenant_id
       and sc.passed
       and sc.module_id = r.module_id
       and (sc.member_id = c.member_id or (mem.profile_id is not null and sc.user_id = mem.profile_id))
       and (sc.expires_at is null or sc.expires_at > now())
       and (r.expires_after_days is null or sc.completed_at > now() - make_interval(days => r.expires_after_days))
       and (r.module_version_id is null
            or sc.module_version_id = r.module_version_id
            or exists (
                 select 1
                   from public.strike_module_versions pinned
                   join public.strike_module_versions passed on passed.module_id = pinned.module_id
                  where pinned.id = r.module_version_id
                    and passed.id = sc.module_version_id
                    and passed.locale <> pinned.locale
               ))
       and exists (
             select 1 from public.strike_module_versions sv
              left join floors f on f.module_id = sv.module_id
              where sv.id = sc.module_version_id and sv.version_number >= coalesce(f.floor, 1)
           )
     group by c.member_id, r.id
  )
  select b.member_id,
         mem.display_name,
         r.module_id,
         r.title,
         case
           when b.passes > 0 then 'current'
           when b.member_id in (select o.member_id from overridden o) then 'overridden'
           else 'missing'
         end,
         case when b.never_expires then null else b.expires_at end
    from best b
    join reqs r on r.id = b.requirement_id
    join public.members mem on mem.id = b.member_id and mem.tenant_id = p_tenant_id
   order by mem.display_name, r.title;
end;
$$;

revoke execute on function public.permit_training_status(uuid, text, uuid, uuid[]) from anon, public;
grant  execute on function public.permit_training_status(uuid, text, uuid, uuid[]) to authenticated, service_role;

drop policy if exists strike_assignments_read on public.strike_assignments;
create policy strike_assignments_read on public.strike_assignments
  for select to authenticated
  using (
    ((select public.active_tenant_id()) is null or tenant_id = (select public.active_tenant_id()))
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or (select public.is_superadmin())
      or (
        tenant_id in (select public.current_user_tenant_ids())
        and (
          target_type = 'tenant'
          or (target_type = 'user' and target_id = (select auth.uid())::text)
          or (target_type = 'member' and target_id in (select cm::text from public.current_member_ids() as cm))
          or (
            target_type = 'role'
            and exists (
              select 1
                from public.tenant_memberships m
               where m.tenant_id = strike_assignments.tenant_id
                 and m.user_id = (select auth.uid())
                 and m.role = strike_assignments.target_id
            )
          )
          or (
            target_type in ('department', 'site')
            and exists (
              select 1
                from public.members mem
               where mem.tenant_id = strike_assignments.tenant_id
                 and mem.id in (select public.current_member_ids())
                 and lower(btrim(case when strike_assignments.target_type = 'department' then mem.department else mem.site_label end))
                     = lower(btrim(strike_assignments.target_id))
            )
          )
        )
      )
    )
  );

notify pgrst, 'reload schema';

commit;
