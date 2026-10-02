-- Migration 298: the compliance-obligations register and its evaluation of
-- compliance (ISO 14001 clauses 6.1.3 and 9.1.2).
--
-- The compliance calendar (migration 192) becomes the legal register
-- (docs/ems/adr/0001 Q3). Its deadline fields (cadence, next_due_at) keep
-- meaning "when something is due". The register adds where the obligation
-- comes from, where it applies, why it applies, when it was last reviewed,
-- and how often compliance with it is evaluated.
--
--   ms_compliance_evaluations  one row per evaluation of one obligation. An
--                              open row is the evaluator's to-do; recording
--                              a result closes it, and a closed row is a
--                              sealed record.
--
-- Access tightens (docs/ems/phase-1-plan.md D9). Until now any tenant
-- member, viewers included, could write calendar rows directly through
-- PostgREST; only the API asked for an admin. Writes are now admin-only in
-- the database too, and the facility predicate migration 211 skipped (its
-- loop matched policy names ending in _tenant_scope; these start ccal_) is added.
--
-- Idempotent. Rollback: 298_rollback.sql.

begin;

-- ── Register columns on the calendar ─────────────────────────────────────
alter table public.compliance_calendar_obligations
  add column if not exists discipline              text,
  add column if not exists source_kind             text,
  add column if not exists jurisdiction            text,
  add column if not exists applicability_rationale text,
  add column if not exists evaluation_cadence_days int,
  add column if not exists last_reviewed_at        timestamptz,
  add column if not exists reviewed_by             uuid references public.profiles(id) on delete set null,
  add column if not exists next_review_due         date;

-- Existing rows: OSHA system obligations are OH&S, the EPCRA one is
-- environmental, and tenant-created rows count for both registers.
update public.compliance_calendar_obligations
   set discipline = case system_key
                      when 'osha-300a-post'  then 'ohs'
                      when 'osha-ita-submit' then 'ohs'
                      when 'epcra-tier-ii'   then 'ems'
                      else 'integrated'
                    end
 where discipline is null;

-- Never reviewed as a register row yet: first review due a year after creation.
update public.compliance_calendar_obligations
   set next_review_due = (created_at::date + 365)
 where next_review_due is null;

alter table public.compliance_calendar_obligations
  alter column discipline set default 'integrated',
  alter column discipline set not null,
  alter column next_review_due set default (current_date + 365),
  alter column next_review_due set not null;

alter table public.compliance_calendar_obligations
  drop constraint if exists ccal_obligations_discipline_check,
  drop constraint if exists ccal_obligations_source_kind_check,
  drop constraint if exists ccal_obligations_jurisdiction_check,
  drop constraint if exists ccal_obligations_evaluation_cadence_check;
alter table public.compliance_calendar_obligations
  add constraint ccal_obligations_discipline_check
    check (discipline in ('ems','ohs','integrated')),
  add constraint ccal_obligations_source_kind_check
    check (source_kind in ('law','permit','contract','voluntary','internal')),
  -- Same grammar as parseJurisdiction() in packages/core: state rules stay data, never code.
  add constraint ccal_obligations_jurisdiction_check
    check (jurisdiction ~ '^(federal|state:[A-Z]{2}|local:.+)$'),
  add constraint ccal_obligations_evaluation_cadence_check
    check (evaluation_cadence_days between 1 and 3650);

create index if not exists idx_ccal_obligations_register
  on public.compliance_calendar_obligations (tenant_id, discipline, status);

-- Migration 192 had no touch trigger; routes stamped updated_at by hand.
drop trigger if exists trg_ccal_obligations_touch on public.compliance_calendar_obligations;
create trigger trg_ccal_obligations_touch
  before update on public.compliance_calendar_obligations
  for each row execute function public.touch_updated_at();

-- Completion events had no audit trigger at all.
drop trigger if exists trg_audit_ccal_events on public.compliance_calendar_events;
create trigger trg_audit_ccal_events
  after insert or update or delete on public.compliance_calendar_events
  for each row execute function public.log_audit('id');

-- ── Calendar RLS: members read, admins write (D9) ────────────────────────
drop policy if exists ccal_obligations_tenant_scope on public.compliance_calendar_obligations;
drop policy if exists ccal_obligations_member_read  on public.compliance_calendar_obligations;
drop policy if exists ccal_obligations_admin_write  on public.compliance_calendar_obligations;
create policy ccal_obligations_member_read on public.compliance_calendar_obligations
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );
create policy ccal_obligations_admin_write on public.compliance_calendar_obligations
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );

-- Events inherit their facility through obligation_id, so no facility clause.
drop policy if exists ccal_events_tenant_scope on public.compliance_calendar_events;
drop policy if exists ccal_events_member_read  on public.compliance_calendar_events;
drop policy if exists ccal_events_admin_write  on public.compliance_calendar_events;
create policy ccal_events_member_read on public.compliance_calendar_events
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
create policy ccal_events_admin_write on public.compliance_calendar_events
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

-- Target for the same-tenant foreign key from evaluations.
-- Added only if missing: once other tables' foreign keys depend on it, it cannot be dropped and re-added.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'nonconformities_tenant_id_id_key') then
    alter table public.nonconformities add constraint nonconformities_tenant_id_id_key unique (tenant_id, id);
  end if;
end $$;

-- ── ms_compliance_evaluations ────────────────────────────────────────────
create table if not exists public.ms_compliance_evaluations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- A sealed row cannot be rewritten, so none of these references nulls
  -- itself on delete: each blocks deleting the facility or person instead
  -- (migration 210's facility_id, and the 019 / 045 precedent for people).
  facility_id      uuid references public.facilities(id),
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  obligation_id    uuid not null,
  scheduled_for    date not null,
  assigned_to      uuid references public.profiles(id),
  completed_at     timestamptz,
  evaluator_id     uuid references public.profiles(id),
  result           text check (result in ('compliant','noncompliant','not_applicable','undetermined')),
  notes            text,
  nonconformity_id uuid,
  created_by       uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A completed evaluation has a result and an evaluator; an open one has neither.
  constraint ms_compliance_evaluations_completion
    check ((completed_at is null) = (result is null) and (completed_at is null) = (evaluator_id is null)),
  -- A noncompliant result always opens a nonconformity (phase-1-plan D6).
  constraint ms_compliance_evaluations_noncompliant_has_nc
    check (result is distinct from 'noncompliant' or nonconformity_id is not null),
  -- "Not applicable" must say why.
  constraint ms_compliance_evaluations_not_applicable_has_notes
    check (result is distinct from 'not_applicable' or length(btrim(coalesce(notes, ''))) > 0),
  -- no action on both: an evaluated obligation, or a nonconformity an
  -- evaluation points at, cannot be deleted on its own (they are compliance
  -- records), yet a whole tenant's cascade delete still works.
  constraint ms_compliance_evaluations_obligation_fk foreign key (tenant_id, obligation_id)
    references public.compliance_calendar_obligations (tenant_id, id),
  constraint ms_compliance_evaluations_nonconformity_fk foreign key (tenant_id, nonconformity_id)
    references public.nonconformities (tenant_id, id)
);

-- At most one open evaluation per obligation, so the nightly job and a person cannot double-book one.
create unique index if not exists uq_ms_compliance_evaluations_open
  on public.ms_compliance_evaluations (obligation_id) where completed_at is null;
create index if not exists idx_ms_compliance_evaluations_latest
  on public.ms_compliance_evaluations (tenant_id, obligation_id, completed_at desc);
create index if not exists idx_ms_compliance_evaluations_assignee
  on public.ms_compliance_evaluations (assigned_to) where completed_at is null;

-- A completed evaluation is a record, not a draft. Deletion is closed by RLS,
-- not by this trigger, so a tenant's cascade delete still works.
create or replace function public.ms_compliance_evaluations_sealed()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.completed_at is not null then
    raise exception 'ms_compliance_evaluations % is complete and sealed; record a new evaluation instead', old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_ms_compliance_evaluations_sealed on public.ms_compliance_evaluations;
create trigger trg_ms_compliance_evaluations_sealed
  before update on public.ms_compliance_evaluations
  for each row execute function public.ms_compliance_evaluations_sealed();

drop trigger if exists trg_ms_compliance_evaluations_touch on public.ms_compliance_evaluations;
create trigger trg_ms_compliance_evaluations_touch
  before update on public.ms_compliance_evaluations
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_ms_compliance_evaluations on public.ms_compliance_evaluations;
create trigger trg_audit_ms_compliance_evaluations
  after insert or update or delete on public.ms_compliance_evaluations
  for each row execute function public.log_audit('id');

-- Members read. Admins schedule (the nightly job uses the service role).
-- Admins, or the assigned evaluator, record the result. Nobody deletes.
alter table public.ms_compliance_evaluations enable row level security;

drop policy if exists ms_compliance_evaluations_member_read on public.ms_compliance_evaluations;
create policy ms_compliance_evaluations_member_read on public.ms_compliance_evaluations
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );
drop policy if exists ms_compliance_evaluations_admin_insert on public.ms_compliance_evaluations;
create policy ms_compliance_evaluations_admin_insert on public.ms_compliance_evaluations
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_compliance_evaluations_evaluator_update on public.ms_compliance_evaluations;
create policy ms_compliance_evaluations_evaluator_update on public.ms_compliance_evaluations
  for update to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
      or (assigned_to = auth.uid() and tenant_id in (select public.current_user_tenant_ids()))
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_admin_tenant_ids())
      or public.is_superadmin()
      or (assigned_to = auth.uid() and tenant_id in (select public.current_user_tenant_ids()))
    )
  );
revoke delete on public.ms_compliance_evaluations from authenticated, anon;

-- ── ms_obligation_register: the register's list in one query ─────────────
-- Each obligation with its latest completed evaluation and its open one
-- folded in, joined laterally on idx_ms_compliance_evaluations_latest so
-- tenant and facility filters reach the obligations first. Columns are
-- listed rather than o.*, so the calendar can change without this view
-- pinning a column it no longer wants.
create or replace view public.ms_obligation_register
with (security_invoker = true) as
select o.id, o.tenant_id, o.facility_id, o.title, o.description, o.regulatory_ref, o.category,
       o.cadence, o.cadence_days, o.next_due_at, o.owner_user_id, o.site_label, o.status,
       o.source, o.system_key, o.discipline, o.source_kind, o.jurisdiction, o.applicability_rationale,
       o.evaluation_cadence_days, o.last_reviewed_at, o.reviewed_by, o.next_review_due,
       o.created_by, o.created_at, o.updated_at,
       last_eval.id               as last_evaluation_id,
       last_eval.completed_at     as last_evaluated_at,
       last_eval.result           as last_result,
       last_eval.nonconformity_id as last_nonconformity_id,
       open_eval.id               as open_evaluation_id,
       open_eval.scheduled_for    as open_evaluation_due,
       open_eval.assigned_to      as open_evaluation_assignee
  from public.compliance_calendar_obligations o
  left join lateral (
    select e.id, e.completed_at, e.result, e.nonconformity_id
      from public.ms_compliance_evaluations e
     where e.tenant_id = o.tenant_id and e.obligation_id = o.id and e.completed_at is not null
     order by e.completed_at desc, e.id desc
     limit 1
  ) last_eval on true
  left join lateral (
    select e.id, e.scheduled_for, e.assigned_to
      from public.ms_compliance_evaluations e
     where e.tenant_id = o.tenant_id and e.obligation_id = o.id and e.completed_at is null
     limit 1   -- uq_ms_compliance_evaluations_open: there is at most one
  ) open_eval on true;

notify pgrst, 'reload schema';

commit;
