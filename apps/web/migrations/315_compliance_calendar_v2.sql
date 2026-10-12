-- Migration 315: compliance calendar v2 - library metadata, reminders and the
-- period-end anchor, added to the obligations register.
--
-- 1. Library metadata: which environmental program, which legal register entry and
--    checklist template an obligation comes from, which library item it is, and
--    whether it is anchored to a period end (so completing it keeps it on period
--    ends rather than drifting).
-- 2. lead_days (reminder window) and last_reminded_on (the weekly throttle).
-- 3. source widened to 'library' and 'ai' next to 'system' and 'tenant'.
--
-- Access and scope are NOT changed here. The obligations register (migration 298)
-- already scopes rows to the active site with shared rows (facility_id null) in
-- both modes, and limits writes to tenant admins. An earlier draft of this
-- migration recreated the old member-writable policy; it must not, so there is no
-- policy statement in this file. The jurisdiction column is also 298's.
--
-- Library obligations use system_key 'env:<library key>:<facility id>', so the
-- existing unique (tenant_id, system_key) index makes seeding idempotent.
--
-- 4. Completing a deadline. env_complete_obligation() records that the occurrence
--    due on a date was done and moves the deadline on, in one transaction. It
--    extends the register's own ms_record_obligation_occurrence (304) in the four
--    ways the suite needs: a person who SUBMITTED the checklist that satisfies the
--    deadline may complete it (the register admits only its owner or an admin, and
--    a member who runs a checklist is usually neither), the completion can carry
--    the checklist and an evidence file, it honours the active site, and a
--    period-end deadline stays on period ends (ms_advance_due_date lets 31 March
--    become 1 July; env_advance_due_date keeps 30 June).
--
-- Depends on 298 (obligations register), 304 (ms_advance_due_date), 311
-- (legal_register), 314 (checklist runs, inspections.domain, events.inspection_id)
-- and 193 (inspection_templates). Idempotent. Rollback: 315_rollback.sql
-- (destructive: see its header).

begin;

alter table public.compliance_calendar_obligations
  add column if not exists program text
    check (program is null or program in ('stormwater','outfall','air','wastewater','hazardous_waste','manifest','spcc','epcra')),
  add column if not exists legal_register_id uuid references public.legal_register(id) on delete set null,
  add column if not exists checklist_template_id uuid references public.inspection_templates(id) on delete set null,
  add column if not exists library_key text check (library_key is null or length(library_key) <= 120),
  add column if not exists due_anchor text not null default 'fixed' check (due_anchor in ('fixed', 'period_end')),
  add column if not exists lead_days int not null default 30 check (lead_days between 0 and 365),
  add column if not exists last_reminded_on date;

-- Widen the source check without guessing its generated name.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.compliance_calendar_obligations'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source%'
       and pg_get_constraintdef(oid) ilike '%system%'
  loop
    execute format('alter table public.compliance_calendar_obligations drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.compliance_calendar_obligations'::regclass
       and conname = 'compliance_calendar_obligations_source_check'
  ) then
    alter table public.compliance_calendar_obligations
      add constraint compliance_calendar_obligations_source_check
      check (source in ('system', 'tenant', 'library', 'ai'));
  end if;
end $$;

create index if not exists idx_ccal_obligation_facility_due
  on public.compliance_calendar_obligations (tenant_id, facility_id, next_due_at) where status = 'open';

-- ── Date arithmetic that keeps a period-end deadline on period ends ──────────
-- p_period_end false: identical to the register's ms_advance_due_date, which
-- mirrors the calendar's JavaScript arithmetic, month overflow included (31 Jan +
-- 1 month = 3 Mar). True, for the month cadences: a deadline on the last day of its
-- month stays on the last day of the month it moves to (31 Mar + 3 months = 30 Jun),
-- and any other day is clamped to that month's last day (30 Jan + 1 month = 28 or
-- 29 Feb). Cadences that are not whole months ('once', 'custom_days') are unchanged.
create or replace function public.env_advance_due_date(p_current date, p_cadence text, p_cadence_days int, p_period_end boolean)
returns date
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_months         int := case p_cadence
                            when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6 when 'annual' then 12
                            when 'biennial' then 24 when 'triennial' then 36 when 'quinquennial' then 60 end;
  v_first_target   date;
  v_last_target    date;
  v_was_month_end  boolean;
begin
  if not coalesce(p_period_end, false) or v_months is null then
    return public.ms_advance_due_date(p_current, p_cadence, p_cadence_days);
  end if;
  v_first_target  := (date_trunc('month', p_current) + make_interval(months => v_months))::date;
  v_last_target   := (v_first_target + interval '1 month' - interval '1 day')::date;
  v_was_month_end := p_current = (date_trunc('month', p_current) + interval '1 month' - interval '1 day')::date;
  return case when v_was_month_end then v_last_target
              else least(v_first_target + (extract(day from p_current)::int - 1), v_last_target) end;
end $$;

-- ── Completing a deadline ────────────────────────────────────────────────────
-- Definer, because RLS keeps obligations and events admin-written and the people
-- this admits are not all admins; the checks below stand in for RLS. auth.uid()
-- reads the caller's token, so log_audit() still records who did it.
--
-- Who may complete (all within the active tenant and site, if any):
--   * a tenant admin or owner, or a superadmin; or
--   * the deadline's owner, who is a member; or
--   * a member who SUBMITTED the checklist that satisfies this deadline: the
--     inspection is environmental, submitted, submitted by the caller, started
--     against this deadline (its run), from this deadline's checklist template, at
--     this site, for this very occurrence.
-- Anyone else gets "not found", never "forbidden": the answer does not confirm
-- that a deadline exists.
--
-- Whatever the caller, a checklist or evidence file they name is checked: the
-- inspection must be a submitted environmental one in the same account and must
-- not already have completed a different deadline, and evidence must be a file
-- under the account's own folder.
--
-- p_due_on must be the date still due, so a second click, or a checklist that
-- finishes after someone else completed the deadline, cannot complete the next
-- period by accident. Replaying the same checklist returns the original event.
create or replace function public.env_complete_obligation(
  p_obligation_id uuid,
  p_due_on        date,
  p_note          text default null,
  p_evidence_id   text default null,
  p_inspection_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ob       public.compliance_calendar_obligations%rowtype;
  v_caller   uuid := auth.uid();
  v_allowed  boolean;
  v_event_id uuid;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_caller is null then
    raise exception 'Sign in to complete a deadline.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_ob from public.compliance_calendar_obligations where id = p_obligation_id for update;

  -- Each test is coalesced on its own: with no owner, "owner = caller" is NULL,
  -- and NULL must never read as permission.
  v_allowed := found
    and (public.active_tenant_id() is null or v_ob.tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or v_ob.facility_id is null or v_ob.facility_id = public.active_facility_id())
    and (
      coalesce(v_ob.tenant_id in (select public.current_user_admin_tenant_ids()), false)
      or coalesce(public.is_superadmin(), false)
      or (
        coalesce(v_ob.tenant_id in (select public.current_user_tenant_ids()), false)
        and (
          coalesce(v_ob.owner_user_id = v_caller, false)
          or (
            p_inspection_id is not null
            and exists (
              select 1
                from public.inspections i
                join public.environmental_checklist_runs r on r.inspection_id = i.id
               where i.id             = p_inspection_id
                 and i.tenant_id      = v_ob.tenant_id
                 and i.domain         = 'environmental'
                 and i.status         = 'submitted'
                 and i.submitted_by   = v_caller
                 and i.template_id    = v_ob.checklist_template_id
                 and r.tenant_id      = v_ob.tenant_id
                 and r.obligation_id  = v_ob.id
                 and r.facility_id    = v_ob.facility_id
                 and r.occurrence_at  = p_due_on
            )
          )
        )
      )
    );
  if not v_allowed then
    raise exception 'obligation % not found', p_obligation_id using errcode = 'no_data_found';
  end if;

  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'A note can be at most 2000 characters.' using errcode = 'check_violation';
  end if;
  if p_evidence_id is not null and (
       length(p_evidence_id) > 300
       or position('..' in p_evidence_id) > 0
       or left(p_evidence_id, length(v_ob.tenant_id::text) + 1) <> v_ob.tenant_id::text || '/') then
    raise exception 'Evidence must be a file in this account.' using errcode = 'check_violation';
  end if;

  if p_inspection_id is not null then
    if not exists (
      select 1 from public.inspections i
       where i.id = p_inspection_id and i.tenant_id = v_ob.tenant_id and i.domain = 'environmental' and i.status = 'submitted'
    ) then
      raise exception 'The checklist must be a submitted environmental checklist in this account.' using errcode = 'check_violation';
    end if;
    select e.id into v_event_id from public.compliance_calendar_events e
     where e.inspection_id = p_inspection_id and e.obligation_id = v_ob.id;
    if found then
      return v_event_id;   -- this very checklist already completed this deadline
    end if;
    if exists (select 1 from public.compliance_calendar_events e where e.inspection_id = p_inspection_id) then
      raise exception 'That checklist already completed a different deadline.' using errcode = 'check_violation';
    end if;
  end if;

  if v_ob.status <> 'open' then
    raise exception 'This deadline is %, so there is nothing due to record.', v_ob.status using errcode = 'check_violation';
  end if;
  if v_ob.next_due_at is distinct from p_due_on then
    raise exception 'The occurrence due on % is already recorded; the next one is due on %.', p_due_on, v_ob.next_due_at
      using errcode = 'check_violation';
  end if;

  insert into public.compliance_calendar_events (tenant_id, obligation_id, occurrence_at, completed_by, evidence_id, inspection_id, note)
  values (v_ob.tenant_id, v_ob.id, v_ob.next_due_at, v_caller, p_evidence_id, p_inspection_id, v_note)
  returning id into v_event_id;

  update public.compliance_calendar_obligations
     set next_due_at = public.env_advance_due_date(v_ob.next_due_at, v_ob.cadence, v_ob.cadence_days, v_ob.due_anchor = 'period_end'),
         status      = case when v_ob.cadence = 'once' then 'completed' else 'open' end
   where id = v_ob.id;

  return v_event_id;
end $$;

revoke all on function public.env_complete_obligation(uuid, date, text, text, uuid) from public, anon;
grant execute on function public.env_complete_obligation(uuid, date, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
