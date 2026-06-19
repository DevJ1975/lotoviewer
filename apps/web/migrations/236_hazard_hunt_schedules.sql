-- Migration 236: Hazard Hunt schedules.
--
-- A Hazard Hunt is a recurring, OSHA/Cal-OSHA-driven workplace inspection. It
-- reuses the generic inspection engine (migration 193): the checklist itself is
-- just an `inspection_templates` row with category='hazard_hunt' and its
-- `inspection_template_items`. What the engine does NOT model is *cadence* —
-- "run this template every day / week / month and create the run automatically".
--
-- Cadence is Hazard-Hunt-specific. Bolting nullable cadence columns onto the
-- generic `inspection_templates` table would be speculative for every other
-- inspection type and force the generic builder to special-case them. Instead
-- this companion table holds the recurrence, one row per hazard-hunt template.
-- That makes the illegal state ("a cadence on a non-Hazard-Hunt template")
-- unrepresentable.
--
-- The cron in /api/cron/hazard-hunt-generate reads active rows, and for each one
-- that is due (per the cadence + anchor vs. last_generated_on) inserts an
-- `inspections` run from the template — the same run-creation the engine already
-- supports. This table only governs *when*.
--
-- Idempotent.

begin;

create table if not exists public.hazard_hunt_schedules (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  -- One schedule per template. The template carries the checklist content;
  -- this row carries the recurrence.
  template_id              uuid not null references public.inspection_templates(id) on delete cascade,
  cadence                  text not null check (cadence in ('daily','weekly','monthly')),
  -- Recurrence anchors. weekly uses day_of_week (0=Sunday..6=Saturday);
  -- monthly uses day_of_month (1..28, capped at 28 so every month has the day).
  -- daily ignores both. Exactly which anchor applies is derived from `cadence`
  -- by the cron; the columns are nullable because each cadence uses at most one.
  day_of_week              int check (day_of_week is null or day_of_week between 0 and 6),
  day_of_month             int check (day_of_month is null or day_of_month between 1 and 28),
  -- Default assignee for generated runs (nullable: unassigned runs are allowed).
  default_assignee_user_id uuid references public.profiles(id) on delete set null,
  active                   boolean not null default true,
  -- Watermark: the date a run was last auto-generated for this schedule. The
  -- cron uses it to stay idempotent (never generate twice for the same period).
  last_generated_on        date,
  created_by               uuid references public.profiles(id) on delete set null,
  updated_by               uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (template_id)
);

create index if not exists idx_hazard_hunt_schedules_tenant_active
  on public.hazard_hunt_schedules(tenant_id, active, cadence);

-- RLS: tenant-scope (same predicate as the inspection engine, migration 193).
alter table public.hazard_hunt_schedules enable row level security;
drop policy if exists hazard_hunt_schedules_tenant_scope on public.hazard_hunt_schedules;
create policy hazard_hunt_schedules_tenant_scope on public.hazard_hunt_schedules
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists trg_hazard_hunt_schedules_touch on public.hazard_hunt_schedules;
create trigger trg_hazard_hunt_schedules_touch
  before update on public.hazard_hunt_schedules
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_hazard_hunt_schedules on public.hazard_hunt_schedules;
create trigger trg_audit_hazard_hunt_schedules
  after insert or update or delete on public.hazard_hunt_schedules
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
