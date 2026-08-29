-- Migration 230: EM-385 Compliance — register items + status audit log.
--
-- One row per tracked requirement on a project. Seeded from the catalog
-- (migration 228) at project creation; custom items (requirement_id NULL) can
-- be added later. Status changes are the auditable event, so this table gets a
-- dedicated append-only audit log with the same three-layer enforcement as
-- near_misses (migration 042): REVOKE + immutable trigger + SECURITY DEFINER
-- capture trigger.
--
-- This is a CHILD of em385_projects: it carries tenant_id (for RLS) but NO
-- facility_id — facility scope is inherited through the project FK (matches the
-- migration 210 "child tables excluded" doctrine).
--
-- Idempotent.

begin;

create table if not exists public.em385_register_items (
  id                            uuid not null primary key default gen_random_uuid(),
  tenant_id                     uuid not null references public.tenants(id) on delete cascade,
  project_id                    uuid not null references public.em385_projects(id) on delete cascade,
  -- Catalog row this item instantiates; NULL for a custom item.
  requirement_id                uuid references public.em385_requirements(id),

  title                         text not null,
  category                      text not null check (category in (
    'app_plan','site_specific_plan','form_record','training_cert',
    'competent_person','inspection','permit','exposure_medical')),

  status                        text not null default 'not_started' check (status in (
    'not_started','in_progress','submitted','accepted','expired','not_applicable')),

  -- EM 385-1-1 requires a documented justification when a required item is
  -- marked not applicable. Enforced here so the rule can't be bypassed by a
  -- direct DB write.
  not_applicable_justification  text,

  responsible_party             text,
  due_date                      date,
  submitted_at                  timestamptz,
  accepted_at                   timestamptz,
  accepted_by                   uuid references auth.users(id),
  -- For records that take effect on a date and expire/renew (certs,
  -- inspections, plans): effective_date drives the retention deadline,
  -- expires_at drives the "expiring soon" nudge.
  effective_date                date,
  expires_at                    date,
  version                       text,

  -- Pointer to the host-module record that is the system-of-record for this
  -- evidence (e.g. a confined-space permit). linked_module is a FEATURES id.
  linked_record_id              text,
  linked_module                 text,

  notes                         text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid references auth.users(id),

  constraint em385_register_items_na_justified check (
    status <> 'not_applicable' or not_applicable_justification is not null
  )
);

create index if not exists idx_em385_register_items_project_status
  on public.em385_register_items(tenant_id, project_id, status);
create index if not exists idx_em385_register_items_project_category
  on public.em385_register_items(tenant_id, project_id, category);
create index if not exists idx_em385_register_items_expiring
  on public.em385_register_items(expires_at) where expires_at is not null;
create index if not exists idx_em385_register_items_due
  on public.em385_register_items(due_date)
  where status not in ('accepted','not_applicable');
-- Keeps a catalog requirement from being seeded twice into the same project
-- (safe re-sync). Custom items (requirement_id NULL) are exempt.
create unique index if not exists uq_em385_register_items_project_requirement
  on public.em385_register_items(project_id, requirement_id)
  where requirement_id is not null;

drop trigger if exists trg_em385_register_items_touch_updated_at on public.em385_register_items;
create trigger trg_em385_register_items_touch_updated_at
  before update on public.em385_register_items
  for each row
  execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- em385_register_item_audit_log — append-only event store (mirrors 042)
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.em385_register_item_audit_log (
  id               bigserial primary key,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  register_item_id uuid not null,
  event_type       text not null check (event_type in ('insert','update','delete')),
  before_row       jsonb,
  after_row        jsonb,
  actor_id         uuid,
  actor_email      text,
  context          text,
  occurred_at      timestamptz not null default now()
);

create index if not exists idx_em385_register_item_audit_item
  on public.em385_register_item_audit_log(register_item_id, occurred_at desc);
create index if not exists idx_em385_register_item_audit_tenant
  on public.em385_register_item_audit_log(tenant_id, occurred_at desc);

-- Layer 1 — role grants.
revoke update, delete on public.em385_register_item_audit_log from public;
revoke update, delete on public.em385_register_item_audit_log from authenticated;
revoke update, delete on public.em385_register_item_audit_log from anon;

-- Layer 2 — immutable trigger.
create or replace function public.em385_register_item_audit_immutable()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'em385_register_item_audit_log is append-only (tg_op=% on row id=%)', tg_op, coalesce(old.id, new.id)
    using errcode = 'integrity_constraint_violation';
end $$;

drop trigger if exists trg_em385_register_item_audit_immutable on public.em385_register_item_audit_log;
create trigger trg_em385_register_item_audit_immutable
  before update or delete on public.em385_register_item_audit_log
  for each row
  execute function public.em385_register_item_audit_immutable();

-- Layer 3 — capture trigger on em385_register_items.
create or replace function public.em385_register_items_audit_capture()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_actor_id    uuid;
  v_actor_email text;
  v_context     text;
begin
  v_actor_id    := nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
  v_actor_email := nullif(current_setting('request.jwt.claims', true)::jsonb->>'email', '');
  v_context     := nullif(current_setting('soteria.audit_context', true), '');

  if (tg_op = 'INSERT') then
    insert into public.em385_register_item_audit_log (tenant_id, register_item_id, event_type, before_row, after_row, actor_id, actor_email, context)
      values (new.tenant_id, new.id, 'insert', null, to_jsonb(new), v_actor_id, v_actor_email, v_context);
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into public.em385_register_item_audit_log (tenant_id, register_item_id, event_type, before_row, after_row, actor_id, actor_email, context)
      values (new.tenant_id, new.id, 'update', to_jsonb(old), to_jsonb(new), v_actor_id, v_actor_email, v_context);
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.em385_register_item_audit_log (tenant_id, register_item_id, event_type, before_row, after_row, actor_id, actor_email, context)
      values (old.tenant_id, old.id, 'delete', to_jsonb(old), null, v_actor_id, v_actor_email, v_context);
    return old;
  end if;
  return null;
end $$;

drop trigger if exists trg_em385_register_items_audit_capture on public.em385_register_items;
create trigger trg_em385_register_items_audit_capture
  after insert or update or delete on public.em385_register_items
  for each row
  execute function public.em385_register_items_audit_capture();

grant insert, select on public.em385_register_item_audit_log to authenticated;
grant usage, select on sequence public.em385_register_item_audit_log_id_seq to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- Row-Level Security (tenant-only — facility inherited via project)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.em385_register_items          enable row level security;
alter table public.em385_register_item_audit_log enable row level security;

drop policy if exists em385_register_items_tenant_scope on public.em385_register_items;
create policy em385_register_items_tenant_scope on public.em385_register_items
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

drop policy if exists em385_register_item_audit_read on public.em385_register_item_audit_log;
create policy em385_register_item_audit_read on public.em385_register_item_audit_log
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

drop policy if exists em385_register_item_audit_insert on public.em385_register_item_audit_log;
create policy em385_register_item_audit_insert on public.em385_register_item_audit_log
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
