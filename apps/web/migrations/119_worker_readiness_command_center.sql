-- Migration 119: Worker Readiness for the Command Center.
--
-- Adds the profile/position/training-matrix layer that lets the home
-- Command Center answer: who am I, what shift/position am I in, what
-- training is required for that position, and what equipment am I
-- certified to operate.

begin;

create table if not exists public.worker_positions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null check (length(trim(title)) between 1 and 120),
  department    text,
  description   text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, title)
);

create index if not exists idx_worker_positions_tenant
  on public.worker_positions(tenant_id, active, title);

create table if not exists public.worker_position_assignments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  position_id         uuid references public.worker_positions(id) on delete set null,
  shift_label         text,
  service_start_date  date,
  supervisor_user_id  uuid references auth.users(id) on delete set null,
  is_current          boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists ux_worker_assignment_current
  on public.worker_position_assignments(tenant_id, user_id)
  where is_current = true;
create index if not exists idx_worker_assignments_position
  on public.worker_position_assignments(tenant_id, position_id);

create table if not exists public.position_training_requirements (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  position_id          uuid not null references public.worker_positions(id) on delete cascade,
  role                 text not null,
  requirement_label    text not null check (length(trim(requirement_label)) between 1 and 160),
  recurrence_months    int check (recurrence_months is null or recurrence_months > 0),
  required             boolean not null default true,
  source_note          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, position_id, role, requirement_label)
);

create index if not exists idx_position_training_requirements_position
  on public.position_training_requirements(tenant_id, position_id, required);

create table if not exists public.position_equipment_requirements (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  position_id          uuid not null references public.worker_positions(id) on delete cascade,
  equipment_family     text not null,
  requirement_label    text not null check (length(trim(requirement_label)) between 1 and 160),
  required             boolean not null default true,
  source_note          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, position_id, equipment_family, requirement_label)
);

create index if not exists idx_position_equipment_requirements_position
  on public.position_equipment_requirements(tenant_id, position_id, required);

comment on table public.position_training_requirements is
  'Placeholder for the required training matrix by position. The Command Center reads this now; the full admin matrix editor can grow on top of it later.';

create or replace view public.training_matrix_placeholder
  with (security_invoker = true)
as
select
  a.tenant_id,
  a.user_id,
  p.full_name,
  wp.title as position_title,
  wp.department,
  a.shift_label,
  r.role,
  r.requirement_label,
  r.recurrence_months,
  tr.completed_at,
  tr.expires_at,
  case
    when tr.id is null then 'missing'
    when tr.expires_at is not null and tr.expires_at < current_date then 'overdue'
    when tr.expires_at is not null and tr.expires_at <= current_date + interval '30 days' then 'due_soon'
    else 'current'
  end as status
from public.worker_position_assignments a
join public.worker_positions wp on wp.id = a.position_id
join public.profiles p on p.id = a.user_id
join public.position_training_requirements r
  on r.position_id = wp.id
 and r.tenant_id = a.tenant_id
 and r.required = true
left join lateral (
  select t.*
    from public.loto_training_records t
   where t.tenant_id = a.tenant_id
     and lower(t.worker_name) = lower(coalesce(p.full_name, p.email))
     and t.role = r.role
   order by t.completed_at desc, t.created_at desc
   limit 1
) tr on true
where a.is_current = true;

alter table public.worker_positions                enable row level security;
alter table public.worker_position_assignments     enable row level security;
alter table public.position_training_requirements  enable row level security;
alter table public.position_equipment_requirements enable row level security;

drop policy if exists worker_positions_read on public.worker_positions;
create policy worker_positions_read on public.worker_positions
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists worker_positions_write on public.worker_positions;
create policy worker_positions_write on public.worker_positions
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists worker_assignments_read on public.worker_position_assignments;
create policy worker_assignments_read on public.worker_position_assignments
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      user_id = auth.uid()
      or tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
    )
  );
drop policy if exists worker_assignments_write on public.worker_position_assignments;
create policy worker_assignments_write on public.worker_position_assignments
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists position_training_requirements_read on public.position_training_requirements;
create policy position_training_requirements_read on public.position_training_requirements
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists position_training_requirements_write on public.position_training_requirements;
create policy position_training_requirements_write on public.position_training_requirements
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists position_equipment_requirements_read on public.position_equipment_requirements;
create policy position_equipment_requirements_read on public.position_equipment_requirements
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists position_equipment_requirements_write on public.position_equipment_requirements;
create policy position_equipment_requirements_write on public.position_equipment_requirements
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

create or replace function public.seed_wls_worker_readiness_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id    uuid;
  v_actor_id     uuid;
  v_position_id  uuid;
  v_seeded       int := 0;
begin
  select id into v_tenant_id from public.tenants where slug = 'wls-demo';
  if v_tenant_id is null then
    raise exception 'seed_wls_worker_readiness_demo: tenant slug=wls-demo not found';
  end if;

  select p.id into v_actor_id
    from public.profiles p
    join public.tenant_memberships m on m.user_id = p.id and m.tenant_id = v_tenant_id
   order by p.is_superadmin desc, p.created_at asc
   limit 1;

  if v_actor_id is null then
    select id into v_actor_id from public.profiles order by created_at asc limit 1;
  end if;
  if v_actor_id is null then
    raise exception 'seed_wls_worker_readiness_demo: no profiles found — log in once before seeding';
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(full_name), ''), 'Jamie Rivera'),
         avatar_url = coalesce(avatar_url, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=256&h=256&q=80'),
         updated_at = now()
   where id = v_actor_id;

  insert into public.worker_positions (tenant_id, title, department, description)
  values (
    v_tenant_id,
    'Maintenance Technician II',
    'Maintenance',
    'Maintains production equipment, performs LOTO, supports confined-space entries, hot work, and powered industrial truck moves.'
  )
  on conflict (tenant_id, title) do update
    set department = excluded.department,
        description = excluded.description,
        active = true,
        updated_at = now()
  returning id into v_position_id;

  insert into public.worker_position_assignments
    (tenant_id, user_id, position_id, shift_label, service_start_date, supervisor_user_id, is_current, notes)
  values (
    v_tenant_id,
    v_actor_id,
    v_position_id,
    'Night shift · 6:00 PM-6:00 AM',
    (current_date - interval '4 years 7 months')::date,
    null,
    true,
    'Demo readiness assignment seeded for the Command Center.'
  )
  on conflict (tenant_id, user_id) where is_current = true do update
    set position_id = excluded.position_id,
        shift_label = excluded.shift_label,
        service_start_date = excluded.service_start_date,
        notes = excluded.notes,
        updated_at = now();

  insert into public.position_training_requirements
    (tenant_id, position_id, role, requirement_label, recurrence_months, source_note)
  values
    (v_tenant_id, v_position_id, 'authorized_employee', 'LOTO authorized employee', 12, 'Required for locktag ownership and equipment servicing.'),
    (v_tenant_id, v_position_id, 'entrant', 'Confined-space entrant', 12, 'Required for maintenance entries.'),
    (v_tenant_id, v_position_id, 'attendant', 'Confined-space attendant', 12, 'Required for entry support.'),
    (v_tenant_id, v_position_id, 'hot_work_operator', 'Hot-work operator', 12, 'Required for welding, cutting, grinding, and brazing.'),
    (v_tenant_id, v_position_id, 'fire_watcher', 'Fire watcher', 12, 'Required for assigned fire-watch duty.'),
    (v_tenant_id, v_position_id, 'hazcom', 'HazCom 2012 baseline', 12, 'Required for chemical handling and SDS access.')
  on conflict (tenant_id, position_id, role, requirement_label) do update
    set recurrence_months = excluded.recurrence_months,
        source_note = excluded.source_note,
        required = true,
        updated_at = now();
  get diagnostics v_seeded = row_count;

  insert into public.position_equipment_requirements
    (tenant_id, position_id, equipment_family, requirement_label, source_note)
  values
    (v_tenant_id, v_position_id, 'forklift_electric', 'Electric forklift operator', 'Needed for battery-area and parts movement.'),
    (v_tenant_id, v_position_id, 'pallet_jack_powered', 'Powered pallet jack operator', 'Needed for maintenance staging and parts movement.'),
    (v_tenant_id, v_position_id, 'aerial_lift_scissor', 'Scissor lift operator', 'Needed for overhead maintenance work.')
  on conflict (tenant_id, position_id, equipment_family, requirement_label) do update
    set source_note = excluded.source_note,
        required = true,
        updated_at = now();

  insert into public.loto_training_records
    (id, tenant_id, worker_name, role, completed_at, expires_at, cert_authority, created_by, notes)
  select gen_random_uuid(), v_tenant_id, coalesce(p.full_name, p.email), t.role,
         t.completed_at, t.expires_at, 'WLS Training Center', v_actor_id, 'Worker readiness demo seed.'
    from public.profiles p
    cross join (values
      ('authorized_employee', current_date - 210, current_date + 155),
      ('entrant',             current_date - 250, current_date + 115),
      ('attendant',           current_date - 340, current_date + 25),
      ('hot_work_operator',   current_date - 180, current_date + 185),
      ('fire_watcher',        current_date - 380, current_date - 15),
      ('hazcom',              current_date - 45,  current_date + 320)
    ) as t(role, completed_at, expires_at)
   where p.id = v_actor_id
     and not exists (
       select 1 from public.loto_training_records r
        where r.tenant_id = v_tenant_id
          and lower(r.worker_name) = lower(coalesce(p.full_name, p.email))
          and r.role = t.role
     );

  insert into public.equipment_operator_authorizations
    (tenant_id, user_id, equipment_family, site_label, authorization_source, trainer_name, evaluator_name, issued_at, evaluation_due_at, expires_at, status)
  values
    (v_tenant_id, v_actor_id, 'forklift_electric', 'WLS Demo', 'Hands-on PIT evaluation', 'Morgan Lee', 'Avery Chen', current_date - 180, current_date + 10, current_date + 185, 'active'),
    (v_tenant_id, v_actor_id, 'pallet_jack_powered', 'WLS Demo', 'Hands-on PIT evaluation', 'Morgan Lee', 'Avery Chen', current_date - 90, current_date + 275, current_date + 275, 'active'),
    (v_tenant_id, v_actor_id, 'aerial_lift_scissor', 'WLS Demo', 'Mobile elevated work platform evaluation', 'Riley Patel', 'Avery Chen', current_date - 420, current_date - 55, current_date - 55, 'expired')
  on conflict (tenant_id, user_id, equipment_family, (coalesce(site_label, ''::text))) do update
    set authorization_source = excluded.authorization_source,
        trainer_name = excluded.trainer_name,
        evaluator_name = excluded.evaluator_name,
        issued_at = excluded.issued_at,
        evaluation_due_at = excluded.evaluation_due_at,
        expires_at = excluded.expires_at,
        status = excluded.status,
        updated_at = now();

  insert into public.bbs_observations
    (tenant_id, submitted_by, observed_at, location_text, department, kind, category, description, immediate_action_taken, severity, likelihood, status)
  select v_tenant_id, v_actor_id, now() - x.ago, x.location_text, x.department, x.kind, x.category, x.description, x.action, x.severity, x.likelihood, x.status
    from (values
      (interval '2 days',  'Packaging line A', 'Packaging',   'safe_behavior',    'PPE',          'Stopped to replace fogged safety glasses before clearing scrap.', 'Recognized the operator and restocked the PPE station.', null,     null,     'closed'),
      (interval '6 days',  'Battery room',     'Maintenance', 'unsafe_condition', 'Housekeeping', 'Charging cable was stretched across the walking path.',            'Rerouted cable through the overhead hook.',              'medium', 'medium', 'closed'),
      (interval '11 days', 'Dock bay 2',       'Distribution','unsafe_condition', 'Traffic',      'Pedestrian gate was propped open during forklift movement.',       'Closed gate and notified shift lead.',                   'high',   'medium', 'in_progress')
    ) as x(ago, location_text, department, kind, category, description, action, severity, likelihood, status)
   where not exists (
     select 1 from public.bbs_observations b
      where b.tenant_id = v_tenant_id
        and b.submitted_by = v_actor_id
        and b.description = x.description
   );

  return format('Seeded WLS worker readiness demo: profile=%s position=%s training_requirements=%s', v_actor_id, v_position_id, v_seeded);
end;
$$;

do $$
declare
  result text;
begin
  result := public.seed_wls_worker_readiness_demo();
  raise notice '%', result;
end $$;

notify pgrst, 'reload schema';

commit;
