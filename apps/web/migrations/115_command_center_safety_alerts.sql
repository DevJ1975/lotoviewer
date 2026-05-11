-- Migration 115: Command Center safety alerts for submitted incidents.
--
-- Creates a durable, tenant-scoped alert record after incident intake so
-- the Command Center can show operational response items independently
-- from the immutable email delivery log in incident_notifications.

begin;

create table if not exists public.command_center_safety_alerts (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  incident_id       uuid not null references public.incidents(id) on delete cascade,
  report_number     text not null,
  title             text not null,
  summary           text not null,
  severity_tone     text not null check (severity_tone in ('critical','warning','attention')),
  priority          int not null default 30 check (priority >= 0),
  status            text not null default 'new' check (status in (
    'new','acknowledged','in_review','escalated','resolved','dismissed'
  )),
  source            text not null default 'incident_submitted' check (source in ('incident_submitted')),
  created_by        uuid references auth.users(id),
  acknowledged_by   uuid references auth.users(id),
  acknowledged_at   timestamptz,
  resolved_by       uuid references auth.users(id),
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, incident_id, source)
);

create index if not exists idx_command_center_safety_alerts_open
  on public.command_center_safety_alerts(tenant_id, priority desc, created_at desc)
  where status in ('new','acknowledged','in_review','escalated');

create index if not exists idx_command_center_safety_alerts_incident
  on public.command_center_safety_alerts(incident_id, created_at desc);

drop trigger if exists trg_command_center_safety_alerts_touch on public.command_center_safety_alerts;
create trigger trg_command_center_safety_alerts_touch
  before update on public.command_center_safety_alerts
  for each row
  execute function public.touch_updated_at();

alter table public.command_center_safety_alerts enable row level security;

drop policy if exists command_center_safety_alerts_tenant_select on public.command_center_safety_alerts;
create policy command_center_safety_alerts_tenant_select on public.command_center_safety_alerts
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists command_center_safety_alerts_tenant_insert on public.command_center_safety_alerts;
create policy command_center_safety_alerts_tenant_insert on public.command_center_safety_alerts
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists command_center_safety_alerts_tenant_update on public.command_center_safety_alerts;
create policy command_center_safety_alerts_tenant_update on public.command_center_safety_alerts
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

grant select, insert, update on public.command_center_safety_alerts to authenticated;

notify pgrst, 'reload schema';

commit;
