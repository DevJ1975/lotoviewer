-- Migration 121: Equipment Readiness schedules and reminder state.

begin;

create table if not exists public.equipment_missed_inspection_rules (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  equipment_record_id uuid references public.loto_equipment(id) on delete cascade,
  equipment_family    text,
  department          text,
  shift_label         text not null default 'daily',
  due_time_local      time not null default '08:00',
  grace_minutes       int not null default 60 check (grace_minutes between 0 and 1440),
  active              boolean not null default true,
  escalation_user_ids uuid[] not null default '{}',
  last_reminded_at    timestamptz,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (
    equipment_record_id is not null
    or equipment_family is not null
    or department is not null
  )
);

create index if not exists idx_equipment_missed_rules_tenant_active
  on public.equipment_missed_inspection_rules(tenant_id, active, due_time_local);

alter table public.equipment_missed_inspection_rules enable row level security;

create policy equipment_missed_rules_read on public.equipment_missed_inspection_rules
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

create policy equipment_missed_rules_write on public.equipment_missed_inspection_rules
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
