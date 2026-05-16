-- Migration 175: §5194 employee right-to-know notifications.
--
-- Cal/OSHA Title 8 §5194(h) (the CA Hazard Communication Standard)
-- requires that employees be informed and trained on hazardous
-- substances in their work area before initial assignment and whenever
-- a new hazard is introduced. Prop 65 layers a §25249.6 "clear and
-- reasonable warning" duty on top — usually satisfied at the workplace
-- by posted signs AND employee training.
--
-- This table is the audit-friendly index of every employee
-- notification event. The trigger on loto_training_records below
-- auto-creates a notifications row when a signed training record
-- is flagged via metadata.prop65_topic = true, so the existing
-- training UI doubles as the §5194 paper trail.
--
-- Idempotent.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 0. metadata column on loto_training_records (idempotent add)
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_training_records
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prop65_notification_method') then
    create type public.prop65_notification_method as enum
      ('posted_sign', 'training', 'email', 'pamphlet');
  end if;
end $$;

create table if not exists public.prop65_notifications (
  id                          uuid        primary key default gen_random_uuid(),
  tenant_id                   uuid        not null references public.tenants(id) on delete cascade,
  -- Optional — a posted-sign notification covers everyone on site,
  -- and there's no per-worker row. A training event yields one row
  -- per attendee.
  worker_id                   uuid        references public.loto_workers(id) on delete set null,
  site_id                     uuid        not null references public.prop65_sites(id) on delete cascade,
  notification_method         public.prop65_notification_method not null,
  notified_at                 timestamptz not null default now(),
  training_record_id          uuid        references public.loto_training_records(id) on delete set null,
  confirmed_by_worker_at      timestamptz,
  notes                       text,
  created_at                  timestamptz not null default now(),
  -- A training notification must reference the training record it
  -- documents; other methods MUST NOT (the FK would be misleading).
  check (
    case notification_method
      when 'training' then training_record_id is not null
      else training_record_id is null
    end
  )
);

create index if not exists idx_prop65_notifications_site
  on public.prop65_notifications (tenant_id, site_id, notified_at desc);
create index if not exists idx_prop65_notifications_worker
  on public.prop65_notifications (tenant_id, worker_id, notified_at desc)
  where worker_id is not null;

comment on table public.prop65_notifications is
  'Cal/OSHA Title 8 §5194(h) right-to-know notification events. Auto-populated from signed training records flagged metadata.prop65_topic = true.';

alter table public.prop65_notifications enable row level security;

drop policy if exists "prop65_notifications_tenant_scope" on public.prop65_notifications;
create policy "prop65_notifications_tenant_scope"
  on public.prop65_notifications
  for all to authenticated
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

drop trigger if exists trg_audit_prop65_notifications on public.prop65_notifications;
create trigger trg_audit_prop65_notifications
  after insert or update or delete on public.prop65_notifications
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────
-- 1. Auto-notify trigger on loto_training_records
-- ────────────────────────────────────────────────────────────────────
-- When a training record carries metadata.prop65_topic = true and has
-- a non-null tenant_id, fire one prop65_notifications row referencing
-- it. We resolve the worker by matching loto_workers.full_name
-- case-insensitively on the same tenant; misses are stored with
-- worker_id = NULL (the notification still counts as posted-form).
--
-- The trigger is SECURITY DEFINER so it can write to the tenant-
-- scoped table regardless of who inserted the training record. The
-- search_path is hardened per AGENTS.md.
create or replace function public.prop65_autocreate_notification()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  is_p65 boolean;
  resolved_worker_id uuid;
  resolved_site_id   uuid;
begin
  -- Flag check — silently no-op when not a Prop 65 topic.
  is_p65 := coalesce((new.metadata->>'prop65_topic')::boolean, false);
  if not is_p65 then return new; end if;

  -- Idempotency: don't insert a duplicate for the same training row.
  if exists (
    select 1 from public.prop65_notifications n
    where n.training_record_id = new.id
  ) then
    return new;
  end if;

  -- Pick the tenant's first Prop 65 site as the default — most tenants
  -- have one CA facility; the admin can re-home the notification later
  -- via /admin/prop65/sites/[id]. If none, skip silently.
  select id into resolved_site_id
  from public.prop65_sites
  where tenant_id = new.tenant_id
  order by created_at asc
  limit 1;
  if resolved_site_id is null then return new; end if;

  select id into resolved_worker_id
  from public.loto_workers
  where tenant_id = new.tenant_id
    and lower(btrim(full_name)) = lower(btrim(new.worker_name))
  limit 1;

  insert into public.prop65_notifications
    (tenant_id, worker_id, site_id, notification_method, notified_at, training_record_id, notes)
  values
    (new.tenant_id, resolved_worker_id, resolved_site_id, 'training',
     coalesce(new.completed_at::timestamptz, now()), new.id,
     'Auto-created from signed Prop 65 training record.');

  return new;
end $$;

drop trigger if exists trg_prop65_autocreate_notification on public.loto_training_records;
create trigger trg_prop65_autocreate_notification
  after insert or update on public.loto_training_records
  for each row execute function public.prop65_autocreate_notification();

notify pgrst, 'reload schema';

commit;
