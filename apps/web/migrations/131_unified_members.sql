-- Migration 131: Unified tenant member roster.
--
-- Adds a canonical members table for every person a tenant tracks:
-- login users, non-login shop-floor workers, contractors, temps, and
-- supervisors. Existing profile/user and LOTO worker records are
-- backfilled into members, while legacy columns remain in place so
-- modules can migrate incrementally.

begin;

create extension if not exists pgcrypto;

create or replace function public.member_normalize_key(p_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g')), '')
$$;

create or replace function public.member_search_hash(p_value text)
returns text
language sql
immutable
set search_path = public, extensions, pg_catalog
as $$
  select case
    when public.member_normalize_key(p_value) is null then null
    else encode(digest(convert_to(public.member_normalize_key(p_value), 'UTF8'), 'sha256'::text), 'hex')
  end
$$;

create or replace function public.member_slug(p_value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(p_value, ''))), '[^a-z0-9]+', '.', 'g'),
      '(^\.+|\.+$)', '', 'g'
    ),
    ''
  )
$$;

create table if not exists public.members (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  profile_id              uuid references public.profiles(id) on delete set null,
  source                  text not null default 'manual'
                            check (source in ('profile','loto_worker','manual','import','hris','scim')),
  source_id               uuid,

  handle                  text not null,
  member_code             text not null,

  legal_name              text,
  preferred_name          text,
  display_name            text not null,
  pronouns                text,
  email                   text,
  phone                   text,
  employee_id             text,
  badge_id                text,
  external_hris_id        text,
  employment_type         text not null default 'employee'
                            check (employment_type in ('employee','contractor','temp','vendor','visitor','other')),
  vendor_company          text,
  department              text,
  site_label              text,
  position_title          text,
  shift_label             text,
  supervisor_member_id    uuid references public.members(id) on delete set null,
  hire_date               date,
  start_date              date,
  language                text,
  emergency_contact_name  text,
  emergency_contact_phone text,

  readiness_status        text not null default 'setup_needed'
                            check (readiness_status in ('ready','attention','restricted','setup_needed','inactive')),
  status                  text not null default 'active'
                            check (status in ('active','suspended','terminated','archived')),
  status_reason           text,
  notification_preferences jsonb not null default '{}'::jsonb,
  sensitive_safety_notes  text,
  notes                   text,
  metadata                jsonb not null default '{}'::jsonb,

  created_by              uuid references public.profiles(id) on delete set null,
  updated_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (tenant_id, handle),
  unique (tenant_id, member_code),
  unique (tenant_id, profile_id),
  check (length(trim(handle)) between 2 and 64),
  check (handle ~ '^[a-z0-9][a-z0-9._-]*$'),
  check (length(trim(display_name)) between 1 and 160)
);

create index if not exists idx_members_tenant_status
  on public.members(tenant_id, status, display_name);
create index if not exists idx_members_profile
  on public.members(profile_id)
  where profile_id is not null;
create index if not exists idx_members_department
  on public.members(tenant_id, department, shift_label)
  where status = 'active';

create table if not exists public.member_identifier_hashes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  member_id       uuid not null references public.members(id) on delete cascade,
  identifier_type text not null
                    check (identifier_type in ('email','employee_id','badge_id','external_hris_id','phone','member_code','handle')),
  search_key_hash text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_member_identifier_hashes_lookup
  on public.member_identifier_hashes(tenant_id, identifier_type, search_key_hash);
create index if not exists idx_member_identifier_hashes_member
  on public.member_identifier_hashes(member_id);

create table if not exists public.member_custom_field_definitions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  field_key       text not null check (field_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  label           text not null check (length(trim(label)) between 1 and 120),
  field_type      text not null default 'text'
                    check (field_type in ('text','number','date','boolean','select','multiselect','url')),
  options         jsonb not null default '[]'::jsonb,
  visibility      text not null default 'tenant'
                    check (visibility in ('tenant','admin','hidden_sensitive')),
  edit_scope      text not null default 'admin'
                    check (edit_scope in ('self','supervisor','admin')),
  required        boolean not null default false,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, field_key)
);

create table if not exists public.member_custom_field_values (
  member_id      uuid not null references public.members(id) on delete cascade,
  field_id       uuid not null references public.member_custom_field_definitions(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  value          jsonb,
  updated_by     uuid references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (member_id, field_id)
);

create table if not exists public.member_status_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  event_type    text not null
                  check (event_type in ('created','updated','status_changed','role_changed','readiness_changed','login_granted','login_revoked','imported')),
  actor_user_id uuid references auth.users(id) on delete set null,
  reason        text,
  old_values    jsonb,
  new_values    jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_member_status_events_member
  on public.member_status_events(tenant_id, member_id, created_at desc);

create or replace function public.member_next_handle(
  p_tenant_id uuid,
  p_base text,
  p_existing_member_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text := coalesce(public.member_slug(p_base), 'member');
  v_candidate text;
  v_i int := 0;
begin
  v_base := left(v_base, 54);
  loop
    v_candidate := case when v_i = 0 then v_base else left(v_base, 54) || '.' || v_i::text end;
    exit when not exists (
      select 1 from public.members m
       where m.tenant_id = p_tenant_id
         and m.handle = v_candidate
         and (p_existing_member_id is null or m.id <> p_existing_member_id)
    );
    v_i := v_i + 1;
  end loop;
  return v_candidate;
end;
$$;

create or replace function public.member_sync_identifier_hashes(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.members%rowtype;
begin
  select * into m from public.members where id = p_member_id;
  if not found then
    return;
  end if;

  delete from public.member_identifier_hashes where member_id = p_member_id;

  insert into public.member_identifier_hashes (tenant_id, member_id, identifier_type, search_key_hash)
  select m.tenant_id, m.id, x.identifier_type, public.member_search_hash(x.value)
    from (values
      ('email',            m.email),
      ('employee_id',      m.employee_id),
      ('badge_id',         m.badge_id),
      ('external_hris_id', m.external_hris_id),
      ('phone',            m.phone),
      ('member_code',      m.member_code),
      ('handle',           m.handle)
    ) as x(identifier_type, value)
   where public.member_search_hash(x.value) is not null;
end;
$$;

create or replace function public.members_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.display_name := nullif(trim(coalesce(new.display_name, '')), '');
  new.display_name := coalesce(
    new.display_name,
    nullif(trim(coalesce(new.preferred_name, '')), ''),
    nullif(trim(coalesce(new.legal_name, '')), ''),
    nullif(trim(coalesce(new.email, '')), ''),
    'Member'
  );

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

drop trigger if exists trg_members_before_write on public.members;
create trigger trg_members_before_write
  before insert or update on public.members
  for each row execute function public.members_before_write();

create or replace function public.members_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.member_sync_identifier_hashes(new.id);
  if tg_op = 'INSERT' then
    insert into public.member_status_events (tenant_id, member_id, event_type, actor_user_id, new_values)
    values (new.tenant_id, new.id, 'created', auth.uid(), to_jsonb(new));
  elsif old.status is distinct from new.status or old.readiness_status is distinct from new.readiness_status then
    insert into public.member_status_events (tenant_id, member_id, event_type, actor_user_id, old_values, new_values)
    values (
      new.tenant_id,
      new.id,
      case when old.status is distinct from new.status then 'status_changed' else 'readiness_changed' end,
      auth.uid(),
      jsonb_build_object('status', old.status, 'readiness_status', old.readiness_status),
      jsonb_build_object('status', new.status, 'readiness_status', new.readiness_status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_members_after_write on public.members;
create trigger trg_members_after_write
  after insert or update on public.members
  for each row execute function public.members_after_write();

drop trigger if exists trg_audit_members on public.members;
create trigger trg_audit_members
  after insert or update or delete on public.members
  for each row execute function public.log_audit('id');

alter table public.members                         enable row level security;
alter table public.member_identifier_hashes        enable row level security;
alter table public.member_custom_field_definitions enable row level security;
alter table public.member_custom_field_values      enable row level security;
alter table public.member_status_events            enable row level security;

drop policy if exists members_tenant_read on public.members;
create policy members_tenant_read on public.members
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );

drop policy if exists members_admin_write on public.members;
create policy members_admin_write on public.members
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

drop policy if exists member_identifier_hashes_admin_read on public.member_identifier_hashes;
create policy member_identifier_hashes_admin_read on public.member_identifier_hashes
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

drop policy if exists member_custom_defs_read on public.member_custom_field_definitions;
create policy member_custom_defs_read on public.member_custom_field_definitions
  for select to authenticated
  using (
    active
    and (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_tenant_ids())
    )
  );
drop policy if exists member_custom_defs_admin_write on public.member_custom_field_definitions;
create policy member_custom_defs_admin_write on public.member_custom_field_definitions
  for all to authenticated
  using (public.is_superadmin() or tenant_id in (select public.current_user_admin_tenant_ids()))
  with check (public.is_superadmin() or tenant_id in (select public.current_user_admin_tenant_ids()));

drop policy if exists member_custom_values_read on public.member_custom_field_values;
create policy member_custom_values_read on public.member_custom_field_values
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or exists (
        select 1 from public.members m
         where m.id = member_custom_field_values.member_id
           and m.profile_id = auth.uid()
      )
    )
  );
drop policy if exists member_custom_values_admin_write on public.member_custom_field_values;
create policy member_custom_values_admin_write on public.member_custom_field_values
  for all to authenticated
  using (public.is_superadmin() or tenant_id in (select public.current_user_admin_tenant_ids()))
  with check (public.is_superadmin() or tenant_id in (select public.current_user_admin_tenant_ids()));

drop policy if exists member_status_events_admin_read on public.member_status_events;
create policy member_status_events_admin_read on public.member_status_events
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      public.is_superadmin()
      or tenant_id in (select public.current_user_admin_tenant_ids())
    )
  );

-- Backfill login users.
insert into public.members (
  tenant_id, profile_id, source, legal_name, preferred_name, display_name,
  email, employment_type, status, created_by, metadata
)
select
  tm.tenant_id,
  p.id,
  'profile',
  p.full_name,
  p.full_name,
  coalesce(nullif(trim(p.full_name), ''), p.email),
  p.email,
  'employee',
  'active',
  tm.invited_by,
  jsonb_build_object('tenant_role', tm.role, 'backfilled_from', 'tenant_memberships')
from public.tenant_memberships tm
join public.profiles p on p.id = tm.user_id
on conflict (tenant_id, profile_id) do update
  set email = excluded.email,
      legal_name = coalesce(public.members.legal_name, excluded.legal_name),
      preferred_name = coalesce(public.members.preferred_name, excluded.preferred_name),
      display_name = coalesce(nullif(public.members.display_name, ''), excluded.display_name),
      metadata = public.members.metadata || excluded.metadata,
      updated_at = now();

-- Backfill non-login LOTO workers.
insert into public.members (
  tenant_id, source, source_id, legal_name, preferred_name, display_name,
  email, employee_id, employment_type, status, notes, created_by, metadata
)
select
  w.tenant_id,
  'loto_worker',
  w.id,
  w.full_name,
  w.full_name,
  w.full_name,
  w.email,
  w.employee_id,
  'employee',
  case when w.active then 'active' else 'archived' end,
  w.notes,
  w.created_by,
  jsonb_build_object('backfilled_from', 'loto_workers')
from public.loto_workers w
where not exists (
  select 1 from public.members m
   where m.tenant_id = w.tenant_id
     and (
       (w.email is not null and m.email = lower(w.email))
       or (w.employee_id is not null and m.employee_id = w.employee_id)
       or (m.source = 'loto_worker' and m.source_id = w.id)
     )
);

-- Compatibility columns for readiness tables. They are nullable during
-- the migration window and backfilled where a profile/member mapping exists.
alter table public.worker_position_assignments
  add column if not exists member_id uuid references public.members(id) on delete set null;
create index if not exists idx_worker_assignments_member
  on public.worker_position_assignments(tenant_id, member_id)
  where member_id is not null;
update public.worker_position_assignments a
   set member_id = m.id
  from public.members m
 where a.member_id is null
   and m.tenant_id = a.tenant_id
   and m.profile_id = a.user_id;

alter table public.equipment_operator_authorizations
  add column if not exists member_id uuid references public.members(id) on delete set null;
create index if not exists idx_equipment_authorizations_member
  on public.equipment_operator_authorizations(tenant_id, member_id, status, equipment_family)
  where member_id is not null;
update public.equipment_operator_authorizations a
   set member_id = m.id
  from public.members m
 where a.member_id is null
   and m.tenant_id = a.tenant_id
   and m.profile_id = a.user_id;

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
  m.updated_at
from public.members m
left join public.members sm on sm.id = m.supervisor_member_id
left join public.profiles p on p.id = m.profile_id
left join public.tenant_memberships tm
  on tm.tenant_id = m.tenant_id
 and tm.user_id = m.profile_id;

create or replace view public.v_member_duplicate_identifiers
  with (security_invoker = true)
as
select
  tenant_id,
  identifier_type,
  search_key_hash,
  count(*) as duplicate_count,
  array_agg(member_id order by created_at) as member_ids
from public.member_identifier_hashes
group by tenant_id, identifier_type, search_key_hash
having count(*) > 1;

notify pgrst, 'reload schema';

commit;
