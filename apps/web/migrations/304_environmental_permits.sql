-- Migration 304: Phase 2, the permit vault (docs/ems/phase-2-plan.md).
--
--   environmental_permits                 permits, registrations and plans an
--                                         agency issued to a site, or the site
--                                         filed with one (Lessons L8, L9)
--   compliance_calendar_obligations       permit_id: a permit's conditions are
--     .permit_id                          obligations linked to it (D3)
--   ms_obligation_register                gains permit_id as its last column
--   ms_advance_due_date()                 advanceDueDate() in SQL
--   ms_record_obligation_occurrence()     an obligation's owner or an admin
--                                         records that it was done (D5)
--   ms_notification_log                   what the nightly job already sent (D10)
--
-- Not "permits": that name belongs to the permit-to-work tables (ADR 0001 Q7).
-- A permit is retired, never deleted. Its renewal dates come from its own
-- terms; nothing here computes a regulatory lead time.
--
-- Access: members read; tenant admins write (Phase 1 D8), except that an
-- obligation's owner may record its occurrence through the function below.
--
-- After this migration, re-running 298 fails, because 298's view lacks
-- permit_id and Postgres will not drop a view column; 298 runs in one
-- transaction, so that failure changes nothing.
--
-- Order: apply 304, 305 and 306 before deploying the code that reads them,
-- and revert that code before running the rollbacks (306, 305, then 304).
--
-- Idempotent. Rollback: 304_rollback.sql.

begin;

-- ── environmental_permits ────────────────────────────────────────────────
create table if not exists public.environmental_permits (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  -- A permit is issued to a site (D2).
  facility_id                 uuid not null default public.active_facility_id(),
  program                     text not null check (program in ('air','waste','wastewater','stormwater','spcc','epcra','other')),
  instrument                  text not null default 'permit' check (instrument in ('permit','registration','plan')),
  title                       text not null check (length(btrim(title)) between 1 and 200),
  agency                      text not null check (length(btrim(agency)) between 1 and 200),
  permit_number               text check (permit_number is null or length(btrim(permit_number)) between 1 and 100),
  jurisdiction                text not null check (jurisdiction ~ '^(federal|state:[A-Z]{2}|local:.+)$'),
  holder_of_record            text not null check (length(btrim(holder_of_record)) between 1 and 300),
  issued_on                   date,
  -- Null: no fixed term, such as a permit by rule.
  expires_on                  date,
  -- Taken from the permit's own terms, never computed: lead times differ by program.
  renewal_application_due_on  date,
  -- When the renewal for the current term was submitted; recording the renewed permit clears it.
  renewal_submitted_on        date,
  business_critical           boolean not null default false,
  owner_user_id               uuid,
  notes                       text check (notes is null or length(notes) <= 4000),
  retired_at                  timestamptz,
  retired_reason              text,
  last_reviewed_at            timestamptz,
  reviewed_by                 uuid references public.profiles(id) on delete set null,
  next_review_due             date not null default (current_date + 365),
  created_by                  uuid references public.profiles(id) on delete set null,
  updated_by                  uuid references public.profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint environmental_permits_facility_fk foreign key (tenant_id, facility_id)
    references public.facilities (tenant_id, id),
  -- The owner is a member of this tenant; removing the membership clears only the owner (as migration 302).
  constraint environmental_permits_owner_member_fk foreign key (owner_user_id, tenant_id)
    references public.tenant_memberships (user_id, tenant_id) on delete set null (owner_user_id),
  constraint environmental_permits_term check (expires_on is null or issued_on is null or expires_on > issued_on),
  constraint environmental_permits_renewal_due check (
    renewal_application_due_on is null or (expires_on is not null and renewal_application_due_on <= expires_on)),
  constraint environmental_permits_retired_pair check ((retired_at is null) = (retired_reason is null)),
  constraint environmental_permits_retired_reason check (retired_reason is null or length(btrim(retired_reason)) > 0)
);

-- One active record per agency number: a renewal updates the row rather than adding one.
create unique index if not exists uq_environmental_permits_number
  on public.environmental_permits (tenant_id, lower(btrim(agency)), btrim(permit_number))
  where permit_number is not null and retired_at is null;
create index if not exists idx_environmental_permits_deadline
  on public.environmental_permits (tenant_id, (coalesce(renewal_application_due_on, expires_on)))
  where retired_at is null;
create index if not exists idx_environmental_permits_facility
  on public.environmental_permits (tenant_id, facility_id);

alter table public.environmental_permits enable row level security;

drop policy if exists environmental_permits_member_read on public.environmental_permits;
create policy environmental_permits_member_read on public.environmental_permits
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
  );
drop policy if exists environmental_permits_admin_write on public.environmental_permits;
create policy environmental_permits_admin_write on public.environmental_permits
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id = public.active_facility_id())
  );
-- Retire instead. The service role can still delete, so a tenant's cascade works.
revoke delete on public.environmental_permits from authenticated, anon;

drop trigger if exists trg_environmental_permits_touch on public.environmental_permits;
create trigger trg_environmental_permits_touch
  before update on public.environmental_permits
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_environmental_permits on public.environmental_permits;
create trigger trg_audit_environmental_permits
  after insert or update or delete on public.environmental_permits
  for each row execute function public.log_audit('id');

-- ── A permit's conditions are obligations (D3) ───────────────────────────
alter table public.compliance_calendar_obligations add column if not exists permit_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_calendar_obligations_permit_fk') then
    alter table public.compliance_calendar_obligations
      add constraint compliance_calendar_obligations_permit_fk foreign key (tenant_id, permit_id)
        references public.environmental_permits (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_calendar_obligations_permit_source') then
    alter table public.compliance_calendar_obligations
      add constraint compliance_calendar_obligations_permit_source check (permit_id is null or source_kind = 'permit');
  end if;
end $$;
create index if not exists idx_compliance_calendar_obligations_permit
  on public.compliance_calendar_obligations (permit_id) where permit_id is not null;

-- 298's view with permit_id appended: create or replace may only add columns at the end.
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
       open_eval.assigned_to      as open_evaluation_assignee,
       o.permit_id
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

-- ── Doing a condition (D5) ───────────────────────────────────────────────
-- Mirrors advanceDueDate() in packages/core/src/complianceCalendar.ts,
-- including its month overflow: 31 January + 1 month = 3 March, because the
-- day is added to the first of the target month. A PGlite test pins the two.
create or replace function public.ms_advance_due_date(p_current date, p_cadence text, p_cadence_days int)
returns date
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_cadence
    when 'once'        then p_current
    when 'custom_days' then p_current + greatest(coalesce(p_cadence_days, 1), 1)
    else (date_trunc('month', p_current) + make_interval(months => case p_cadence
            when 'monthly'      then 1
            when 'quarterly'    then 3
            when 'semiannual'   then 6
            when 'annual'       then 12
            when 'biennial'     then 24
            when 'triennial'    then 36
            when 'quinquennial' then 60
            else 0 end))::date
         + (extract(day from p_current)::int - 1)
  end
$$;

-- An obligation's owner, or an admin, records that the occurrence due on
-- p_due_on was done, and the due date moves on. Definer, because the owner
-- may not be an admin and RLS keeps obligations and events admin-written;
-- the checks below stand in for RLS. log_audit() still records the caller,
-- since auth.uid() reads the caller's token. p_due_on must be the date still
-- due, so a second click cannot complete the next period by accident.
create or replace function public.ms_record_obligation_occurrence(p_obligation_id uuid, p_due_on date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ob       public.compliance_calendar_obligations%rowtype;
  v_allowed  boolean;
  v_event_id uuid;
begin
  select * into v_ob from public.compliance_calendar_obligations where id = p_obligation_id for update;
  -- Each test is coalesced on its own: with no owner, "owner = caller" is
  -- NULL, and NULL must never read as permission.
  v_allowed := found
    and (public.active_tenant_id() is null or v_ob.tenant_id = public.active_tenant_id())
    and (coalesce(v_ob.tenant_id in (select public.current_user_admin_tenant_ids()), false)
         or coalesce(v_ob.owner_user_id = auth.uid()
                      and v_ob.tenant_id in (select public.current_user_tenant_ids()), false)
         or coalesce(public.is_superadmin(), false));
  if not v_allowed then
    raise exception 'obligation % not found', p_obligation_id using errcode = 'no_data_found';
  end if;
  if v_ob.status <> 'open' then
    raise exception 'This obligation is %, so there is nothing due to record.', v_ob.status
      using errcode = 'check_violation';
  end if;
  if v_ob.next_due_at is distinct from p_due_on then
    raise exception 'The occurrence due on % is already recorded; the next one is due on %.', p_due_on, v_ob.next_due_at
      using errcode = 'check_violation';
  end if;

  insert into public.compliance_calendar_events (tenant_id, obligation_id, occurrence_at, completed_by, note)
  values (v_ob.tenant_id, v_ob.id, v_ob.next_due_at, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_event_id;

  update public.compliance_calendar_obligations
     set next_due_at = public.ms_advance_due_date(v_ob.next_due_at, v_ob.cadence, v_ob.cadence_days),
         status      = case when v_ob.cadence = 'once' then 'completed' else 'open' end
   where id = v_ob.id;
  return v_event_id;
end $$;
revoke all on function public.ms_record_obligation_occurrence(uuid, date, text) from public, anon;
grant execute on function public.ms_record_obligation_occurrence(uuid, date, text) to authenticated;

-- ── What the nightly job already sent (D10) ──────────────────────────────
-- The job claims a key before it sends, so a notice goes out once. The
-- deadline is part of the key, so a new term starts a new countdown.
create table if not exists public.ms_notification_log (
  id            bigserial primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  subject_type  text not null check (subject_type in ('environmental_permit','compliance_obligation')),
  subject_id    uuid not null,
  -- e.g. 'renewal:90:2027-03-01' or 'condition:overdue:2026-12-31'
  notice_key    text not null check (length(notice_key) between 1 and 100),
  recipients    int not null default 0 check (recipients >= 0),
  sent_at       timestamptz not null default now(),
  unique (tenant_id, subject_type, subject_id, notice_key)
);
alter table public.ms_notification_log enable row level security;
-- The cron's service role only: no policies, and no client privileges.
revoke all on public.ms_notification_log from authenticated, anon;

notify pgrst, 'reload schema';

commit;
