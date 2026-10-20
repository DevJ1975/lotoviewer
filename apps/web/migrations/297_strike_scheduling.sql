-- Migration 297: admin-controlled STRIKE scheduling — why an assignment
-- exists, when it is released, and curricula that drip modules out on a
-- schedule ("LOTO 101 now, Confined Space 30 days later").
--
-- * strike_assignments.trigger_kind records the reason an assignment exists:
--   manual | schedule (recurring or curriculum) | permit | pre_job | onboarding.
--   Permit and pre-job gating itself lives in strike_training_requirements
--   + the permit_training_gate triggers; trigger_kind is for reporting.
-- * starts_at hides an assignment from learners until its release date.
-- * recurrence_rule gains calendar frequencies ({freq: monthly|quarterly|
--   semiannual|annual|interval, interval_days?, expiry_days?}); the shape is
--   validated by parseRecurrenceRule (packages/core/src/strikeSchedule.ts)
--   and older {interval_days} rows keep working.
--
-- Idempotent.

begin;

alter table public.strike_assignments
  add column if not exists trigger_kind  text not null default 'manual',
  add column if not exists starts_at     timestamptz,
  add column if not exists curriculum_id uuid;

alter table public.strike_assignments drop constraint if exists strike_assignments_trigger_kind_ck;
alter table public.strike_assignments
  add constraint strike_assignments_trigger_kind_ck
    check (trigger_kind in ('manual', 'schedule', 'permit', 'pre_job', 'onboarding'));

alter table public.strike_assignments drop constraint if exists strike_assignments_recurrence_shape_ck;
alter table public.strike_assignments
  add constraint strike_assignments_recurrence_shape_ck
    check (recurrence_rule is null or jsonb_typeof(recurrence_rule) = 'object');

create index if not exists strike_assignments_release_idx
  on public.strike_assignments(tenant_id, starts_at)
  where status = 'active';

-- ── Curricula ──────────────────────────────────────────────────────────

create table if not exists public.strike_curricula (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 160),
  description  text,
  active       boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.strike_curriculum_items (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  curriculum_id        uuid not null references public.strike_curricula(id) on delete cascade,
  module_id            uuid not null references public.strike_modules(id) on delete cascade,
  sort_order           int not null default 0,
  release_offset_days  int not null default 0 check (release_offset_days >= 0),
  due_after_days       int not null default 14 check (due_after_days > 0),

  unique (curriculum_id, module_id)
);

create index if not exists strike_curriculum_items_curriculum_idx
  on public.strike_curriculum_items(curriculum_id, sort_order);

alter table public.strike_assignments drop constraint if exists strike_assignments_curriculum_fk;
alter table public.strike_assignments
  add constraint strike_assignments_curriculum_fk
    foreign key (curriculum_id) references public.strike_curricula(id) on delete set null;

alter table public.strike_curricula enable row level security;
alter table public.strike_curriculum_items enable row level security;

drop policy if exists strike_curricula_read on public.strike_curricula;
create policy strike_curricula_read on public.strike_curricula
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_curricula_write on public.strike_curricula;
create policy strike_curricula_write on public.strike_curricula
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_curriculum_items_read on public.strike_curriculum_items;
create policy strike_curriculum_items_read on public.strike_curriculum_items
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists strike_curriculum_items_write on public.strike_curriculum_items;
create policy strike_curriculum_items_write on public.strike_curriculum_items
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists strike_curricula_audit on public.strike_curricula;
create trigger strike_curricula_audit
  after insert or update or delete on public.strike_curricula
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
