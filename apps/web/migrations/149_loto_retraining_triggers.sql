-- Migration 142: §1910.147(g)(2) authorized-employee retraining triggers.
--
-- §147(g)(2) requires retraining whenever:
--   - a worker's job assignment changes such that their existing
--     training is no longer adequate
--   - new equipment / energy-control procedures introduce new hazards
--   - a change in machinery, equipment, or processes occurs
--   - the periodic inspection reveals deviations or inadequacies in the
--     worker's knowledge / use of the procedures
--
-- Today nothing in the app surfaces "Jamil's lockout authorization
-- needs to be re-trained because the boiler procedure changed last
-- week." This migration adds a small triggers table + two database
-- triggers that detect the common cases automatically:
--
--   - When a periodic inspection (migration 141) records a deviation
--     and lists workers in the observed roster, create one
--     `deviation_observed` trigger per worker.
--   - When a loto_energy_steps row is INSERT/UPDATE/DELETE on an
--     equipment, create one `procedure_change` trigger per currently-
--     trained worker (defined as workers with a current
--     authorized_employee training record).
--
-- The admin resolves a trigger by linking it to a new training
-- record (loto_training_records.id). Resolution is an UPDATE setting
-- resolved_at + training_record_id.
--
-- Also introduces a convenience view loto_worker_retraining_status
-- that lists each worker with their last training date and unresolved
-- trigger count — the /admin/training-records page uses this to show
-- "Outstanding retraining triggers · resolve" badges.
--
-- Idempotent: re-runs are safe.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. loto_retraining_triggers
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.loto_retraining_triggers (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  worker_id           uuid        not null references public.loto_workers(id) on delete cascade,
  trigger_type        text        not null
                        check (trigger_type in (
                          'new_equipment',
                          'new_hazards',
                          'procedure_change',
                          'deviation_observed',
                          'periodic'
                        )),
  triggered_at        timestamptz not null default now(),
  resolved_at         timestamptz,
  training_record_id  uuid        references public.loto_training_records(id) on delete set null,
  -- Free-text context (e.g. "Periodic inspection 2026-05-15 noted the
  -- worker bypassed the verify_zero_energy step"). Surfaces in the
  -- admin list so the admin knows why this trigger exists.
  reason              text,
  -- The equipment that surfaced the gap, when applicable. NULL for
  -- generic "new_hazards" triggers that aren't equipment-specific.
  equipment_id        text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_loto_retraining_open
  on public.loto_retraining_triggers(tenant_id, worker_id)
  where resolved_at is null;

create index if not exists idx_loto_retraining_recent
  on public.loto_retraining_triggers(tenant_id, triggered_at desc);

comment on table public.loto_retraining_triggers is
  'Per-worker retraining requirements detected automatically (procedure change, periodic-inspection deviation) or recorded by an admin. Open rows surface on the training-records admin page until resolved with a new training record.';

-- ────────────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────────────
alter table public.loto_retraining_triggers enable row level security;

drop policy if exists "loto_retraining_triggers_tenant_scope"
  on public.loto_retraining_triggers;
create policy "loto_retraining_triggers_tenant_scope"
  on public.loto_retraining_triggers
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_audit_loto_retraining_triggers
  on public.loto_retraining_triggers;
create trigger trg_audit_loto_retraining_triggers
  after insert or update or delete on public.loto_retraining_triggers
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────
-- 3. Auto-create on periodic-inspection deviation
-- ────────────────────────────────────────────────────────────────────
-- The periodic inspection's observed roster is stored as a jsonb
-- array of { worker_id, full_name }. When the row is signed AND
-- has a non-empty deviations field, we create one trigger per
-- observed worker.
create or replace function public.create_retraining_from_inspection()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_worker record;
begin
  if new.signed is not true then return null; end if;
  if nullif(btrim(coalesce(new.deviations, '')), '') is null then return null; end if;

  for v_worker in
    select (elem ->> 'worker_id')::uuid as worker_id
      from jsonb_array_elements(coalesce(new.authorized_employees_observed, '[]'::jsonb)) elem
     where elem ->> 'worker_id' is not null
  loop
    insert into public.loto_retraining_triggers (
      tenant_id, worker_id, trigger_type, reason, equipment_id
    )
    values (
      new.tenant_id,
      v_worker.worker_id,
      'deviation_observed',
      format(
        'Periodic inspection on %s recorded a deviation while this worker was observed using the procedure.',
        to_char(new.inspected_at, 'YYYY-MM-DD')
      ),
      new.equipment_id
    );
  end loop;

  return null;
end $$;

drop trigger if exists trg_loto_periodic_inspections_retraining
  on public.loto_periodic_inspections;
create trigger trg_loto_periodic_inspections_retraining
  after insert on public.loto_periodic_inspections
  for each row execute function public.create_retraining_from_inspection();

-- ────────────────────────────────────────────────────────────────────
-- 4. Auto-create on procedure change (loto_energy_steps mutation)
-- ────────────────────────────────────────────────────────────────────
-- "Currently-trained workers on that procedure" is approximated as
-- workers with at least one non-expired `authorized_employee` training
-- record in this tenant. We can't tie a training record to a specific
-- equipment (the training is module-level by design — §147(c)(7) is
-- about LOTO knowledge, not per-machine certs), so every currently-
-- authorized worker gets a procedure-change trigger when ANY equipment
-- the worker would use changes.
create or replace function public.create_retraining_from_step_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_worker record;
  v_tenant_id uuid;
  v_equipment_id text;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  v_equipment_id := coalesce(new.equipment_id, old.equipment_id);

  for v_worker in
    select distinct w.id as worker_id
      from public.loto_workers w
     where w.tenant_id = v_tenant_id
       and w.active = true
       and exists (
         select 1
           from public.loto_training_records r
          where r.tenant_id = v_tenant_id
            and lower(btrim(r.worker_name)) = lower(btrim(w.full_name))
            and r.role = 'authorized_employee'
            and (r.expires_at is null or r.expires_at >= current_date)
       )
  loop
    -- A burst of step edits on one equipment within the same minute
    -- creates one trigger per worker, not one per edit — collapse
    -- redundant rows by checking the worker doesn't already have an
    -- unresolved procedure_change trigger for this equipment.
    if not exists (
      select 1
        from public.loto_retraining_triggers t
       where t.tenant_id    = v_tenant_id
         and t.worker_id    = v_worker.worker_id
         and t.equipment_id = v_equipment_id
         and t.trigger_type = 'procedure_change'
         and t.resolved_at is null
    ) then
      insert into public.loto_retraining_triggers (
        tenant_id, worker_id, trigger_type, reason, equipment_id
      )
      values (
        v_tenant_id,
        v_worker.worker_id,
        'procedure_change',
        format(
          'Energy-isolation procedure for %s changed on %s.',
          v_equipment_id,
          to_char(now(), 'YYYY-MM-DD')
        ),
        v_equipment_id
      );
    end if;
  end loop;

  return null;
end $$;

drop trigger if exists trg_loto_energy_steps_retraining
  on public.loto_energy_steps;
create trigger trg_loto_energy_steps_retraining
  after insert or update or delete on public.loto_energy_steps
  for each row execute function public.create_retraining_from_step_change();

-- ────────────────────────────────────────────────────────────────────
-- 5. View — loto_worker_retraining_status
-- ────────────────────────────────────────────────────────────────────
-- Used by the /admin/training-records page to show outstanding
-- retraining triggers per worker without needing N+1 queries.
create or replace view public.loto_worker_retraining_status
with (security_invoker = true)
as
select
  w.tenant_id,
  w.id                                                                       as worker_id,
  w.full_name,
  w.employee_id,
  w.active,
  (
    select max(r.completed_at)
      from public.loto_training_records r
     where r.tenant_id = w.tenant_id
       and lower(btrim(r.worker_name)) = lower(btrim(w.full_name))
       and r.role = 'authorized_employee'
  ) as last_trained_at,
  (
    select count(*)
      from public.loto_retraining_triggers t
     where t.tenant_id = w.tenant_id
       and t.worker_id = w.id
       and t.resolved_at is null
  ) as open_trigger_count
from public.loto_workers w;

comment on view public.loto_worker_retraining_status is
  'Per-worker rollup of last authorized_employee training date and outstanding §147(g)(2) retraining triggers. security_invoker so RLS applies to the underlying tables.';

notify pgrst, 'reload schema';

commit;
