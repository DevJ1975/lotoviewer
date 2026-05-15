begin;

alter table public.members
  add column if not exists display_name_source text not null default 'system';

alter table public.members
  add column if not exists notification_preferences jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'members_display_name_source_check'
       and conrelid = 'public.members'::regclass
  ) then
    alter table public.members
      add constraint members_display_name_source_check
      check (display_name_source in ('system','self','admin'));
  end if;
end;
$$;

update public.members
   set display_name_source = 'system'
 where display_name_source is null;

create or replace function public.members_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.display_name_source := coalesce(new.display_name_source, 'system');
  new.display_name := nullif(trim(coalesce(new.display_name, '')), '');

  if new.display_name_source <> 'admin' then
    new.display_name := coalesce(
      new.display_name,
      nullif(trim(coalesce(new.preferred_name, '')), ''),
      nullif(trim(coalesce(new.legal_name, '')), ''),
      nullif(trim(coalesce(new.email, '')), ''),
      'Member'
    );
  else
    new.display_name := coalesce(
      new.display_name,
      case when tg_op = 'UPDATE' then nullif(trim(coalesce(old.display_name, '')), '') else null end,
      nullif(trim(coalesce(new.legal_name, '')), ''),
      nullif(trim(coalesce(new.email, '')), ''),
      'Member'
    );
  end if;

  if new.handle is null or trim(new.handle) = '' then
    new.handle := public.member_next_handle(new.tenant_id, new.display_name, new.id);
  else
    new.handle := public.member_slug(new.handle);
  end if;

  if new.member_code is null or trim(new.member_code) = '' then
    new.member_code := 'M-' || upper(substr(replace(new.id::text, '-', ''), 1, 6));
  else
    new.member_code := upper(trim(regexp_replace(new.member_code, '^#', '')));
  end if;

  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.employee_id := nullif(trim(coalesce(new.employee_id, '')), '');
  new.badge_id := nullif(trim(coalesce(new.badge_id, '')), '');
  new.external_hris_id := nullif(trim(coalesce(new.external_hris_id, '')), '');
  new.phone := nullif(trim(coalesce(new.phone, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create or replace view public.v_member_roster
  with (security_invoker = true)
as
select
  m.id as member_id,
  m.tenant_id,
  m.profile_id,
  m.handle,
  m.member_code,
  m.display_name,
  m.legal_name,
  m.preferred_name,
  m.pronouns,
  m.email,
  m.phone,
  m.employee_id,
  m.badge_id,
  m.employment_type,
  m.vendor_company,
  m.department,
  m.site_label,
  m.position_title,
  m.shift_label,
  m.supervisor_member_id,
  sm.display_name as supervisor_name,
  m.language,
  m.emergency_contact_name,
  m.emergency_contact_phone,
  m.readiness_status,
  m.status,
  p.avatar_url,
  p.is_admin,
  p.is_superadmin,
  tm.role as tenant_role,
  m.created_at,
  m.updated_at,
  m.display_name_source,
  m.notification_preferences
from public.members m
left join public.members sm on sm.id = m.supervisor_member_id
left join public.profiles p on p.id = m.profile_id
left join public.tenant_memberships tm
  on tm.tenant_id = m.tenant_id
 and tm.user_id = m.profile_id;

notify pgrst, 'reload schema';

commit;
