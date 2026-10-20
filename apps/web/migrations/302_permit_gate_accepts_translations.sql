-- Migration 302: a pass in another language satisfies a version-pinned
-- training requirement.
--
-- A translation of a STRIKE module is a separate version in its own locale
-- (migration 301; LOTO 101 in Spanish is v2 'es' beside v1 'en'). A
-- requirement pinned to v1 matched only completions of v1, so a Spanish
-- worker who passed the Spanish version was still refused the permit.
--
-- permit_training_status is recreated unchanged except for that one
-- predicate: a completion counts when its version is the pinned one, or a
-- version of the same module in a different language. A newer version in
-- the same language still does not satisfy a pin, as before.
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
    select r.module_id, r.module_version_id, r.expires_after_days, m.title
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
    select c.member_id, r.module_id, max(sc.expires_at) as expires_at, count(sc.id) as passes,
           bool_or(sc.expires_at is null) as never_expires
      from crew c
      cross join reqs r
      join public.members mem on mem.id = c.member_id
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
     group by c.member_id, r.module_id
  )
  select b.member_id,
         mem.display_name,
         b.module_id,
         r.title,
         case
           when b.passes > 0 then 'current'
           when b.member_id in (select o.member_id from overridden o) then 'overridden'
           else 'missing'
         end,
         case when b.never_expires then null else b.expires_at end
    from best b
    join reqs r on r.module_id = b.module_id
    join public.members mem on mem.id = b.member_id
   order by mem.display_name, r.title;
end;
$$;

revoke execute on function public.permit_training_status(uuid, text, uuid, uuid[]) from anon, public;
grant  execute on function public.permit_training_status(uuid, text, uuid, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
