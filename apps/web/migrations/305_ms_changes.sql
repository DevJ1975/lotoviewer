-- Migration 305: Phase 2, management of change (docs/ems/phase-2-plan.md).
--
--   ms_normalize_legal_entity()   normalizeLegalEntity() in SQL (D11)
--   ms_changes                    a change: equipment, chemical, process,
--                                 owner or name, personnel, other (D12)
--   ms_change_impacts             the records it touches, and who resolved
--                                 each (D13, D14)
--   ms_open_change()              opens a change with its impacts in one
--                                 transaction
--
-- Shared management-system core: ISO 14001 6.1.4 and 8.1 now, ISO 45001
-- 8.1.3 later, so both tables carry discipline. The impacts are worked out
-- by changeImpacts() in packages/core and stored as a snapshot when the
-- change opens.
--
-- The database enforces the checklist (D14): a permit's transfer steps need
-- evidence; "confirm holder" is refused while the permit names anyone but
-- the new legal entity; the scope and policy impacts close only once those
-- records are updated; anything else needs a note. Resolved impacts and
-- ended changes are sealed, and a change closes only when every impact is
-- resolved.
--
-- Access: members read; tenant admins open, resolve, close and cancel.
--
-- Idempotent. Rollback: 305_rollback.sql (after 306_rollback.sql).

begin;

-- Mirrors normalizeLegalEntity() in packages/core/src/managementSystem.ts:
-- ASCII letters lower-cased, full stops and commas dropped, runs of spaces,
-- tabs and line breaks collapsed, ends trimmed. translate() rather than
-- lower(), so the result never depends on the database's locale. A PGlite
-- test pins the two together.
create or replace function public.ms_normalize_legal_entity(p text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(
           regexp_replace(
             translate(coalesce(p, ''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.,', 'abcdefghijklmnopqrstuvwxyz'),
             '[ \t\r\n]+', ' ', 'g'),
           '^ | $', '', 'g')
$$;

-- ── ms_changes ───────────────────────────────────────────────────────────
create table if not exists public.ms_changes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- The site the change happens at; null when it covers the whole organization.
  facility_id      uuid,
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  kind             text not null check (kind in ('equipment','chemical','process','ownership_name','personnel','other')),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text not null check (length(btrim(description)) between 1 and 4000),
  process_area     text check (process_area is null or length(btrim(process_area)) between 1 and 100),
  new_legal_entity text check (new_legal_entity is null or length(btrim(new_legal_entity)) between 1 and 300),
  effective_on     date,
  status           text not null default 'open' check (status in ('open','closed','cancelled')),
  -- No on-delete actions on the people and the site: they would update a
  -- sealed record. A change keeps who raised and ended it, and where.
  requested_by     uuid references public.profiles(id),
  opened_at        timestamptz not null default now(),
  -- When and by whom the change was closed or cancelled.
  ended_at         timestamptz,
  ended_by         uuid references public.profiles(id),
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ms_changes_facility_fk foreign key (tenant_id, facility_id)
    references public.facilities (tenant_id, id),
  constraint ms_changes_new_entity_iff_ownership check ((kind = 'ownership_name') = (new_legal_entity is not null)),
  constraint ms_changes_area_for_site_changes check (kind not in ('equipment','process') or process_area is not null),
  constraint ms_changes_ended check ((status = 'open') = (ended_at is null) and (ended_at is null) = (ended_by is null)),
  constraint ms_changes_cancel_reason check (
    (status = 'cancelled') = (cancelled_reason is not null and length(btrim(cancelled_reason)) > 0))
);

create index if not exists idx_ms_changes_open
  on public.ms_changes (tenant_id, status, opened_at desc);

-- ── ms_change_impacts ────────────────────────────────────────────────────
create table if not exists public.ms_change_impacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  change_id       uuid not null,
  -- asset, hazard and control are the Phase 4 and ISO 45001 seams; nothing creates them yet.
  target_type     text not null check (target_type in
                    ('permit','scope','policy','aspect','obligation','objective','asset','hazard','control')),
  target_id       uuid not null,
  step            text check (step in ('notify_agency','submit_transfer','confirm_holder')),
  step_order      smallint not null default 0 check (step_order between 0 and 3),
  action_required text not null check (length(btrim(action_required)) between 1 and 500),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ms_change_impacts_change_fk foreign key (tenant_id, change_id)
    references public.ms_changes (tenant_id, id) on delete cascade,
  constraint ms_change_impacts_resolved check ((resolved_at is null) = (resolved_by is null)),
  constraint ms_change_impacts_steps_are_permits check (step is null or target_type = 'permit')
);

-- One row per target and step; coalesce so a target with no step is unique too.
create unique index if not exists uq_ms_change_impacts_target_step
  on public.ms_change_impacts (change_id, target_type, target_id, coalesce(step, ''));
create index if not exists idx_ms_change_impacts_target
  on public.ms_change_impacts (tenant_id, target_type, target_id);

-- ── Guards ───────────────────────────────────────────────────────────────
-- A change opens open. Its kind, site, process area and new legal entity are
-- what its impacts were worked out from, so they are fixed once it opens.
-- An ended change is sealed; closing needs every impact resolved.
create or replace function public.ms_changes_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_unresolved int;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.ended_at is not null then
      raise exception 'A change opens open.' using errcode = 'check_violation';
    end if;
    new.requested_by := coalesce(auth.uid(), new.requested_by);
    return new;
  end if;

  if old.status <> 'open' then
    raise exception 'This change is %, so it can no longer be edited.', old.status using errcode = 'check_violation';
  end if;
  if (new.id, new.tenant_id, new.facility_id, new.discipline, new.kind, new.process_area,
      new.new_legal_entity, new.requested_by, new.opened_at, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.facility_id, old.discipline, old.kind, old.process_area,
      old.new_legal_entity, old.requested_by, old.opened_at, old.created_at) then
    raise exception 'A change''s kind, site, process area and new legal entity are fixed once it opens.'
      using errcode = 'check_violation';
  end if;

  if new.status = 'closed' then
    select count(*) into v_unresolved
      from public.ms_change_impacts
     where tenant_id = new.tenant_id and change_id = new.id and resolved_at is null;
    if v_unresolved > 0 then
      raise exception '% of this change''s impacts % not resolved yet.', v_unresolved,
        case when v_unresolved = 1 then 'is' else 'are' end
        using errcode = 'check_violation';
    end if;
  end if;
  if new.status <> 'open' then
    new.ended_at := now();
    new.ended_by := coalesce(auth.uid(), new.ended_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_ms_changes_guard on public.ms_changes;
create trigger trg_ms_changes_guard
  before insert or update on public.ms_changes
  for each row execute function public.ms_changes_guard();

-- An impact is created unresolved while its change is open. Afterwards only
-- its resolution may change, once, while the change is open; resolving it
-- applies the D14 rules and stamps who and when.
create or replace function public.ms_change_impacts_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_change          public.ms_changes%rowtype;
  v_discipline      text;
  v_holder          text;
  v_scope_entity    text;
  v_scope_from      date;
  v_policy_signed   date;
  v_evidence        int;
begin
  select * into v_change from public.ms_changes
   where tenant_id = new.tenant_id and id = new.change_id
     for share;
  if not found or v_change.status <> 'open' then
    raise exception 'This change is closed or cancelled, so its impacts can no longer change.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.resolved_at is not null then
      raise exception 'An impact is created unresolved.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.resolved_at is not null then
    raise exception 'This impact is already resolved.' using errcode = 'check_violation';
  end if;
  if (new.id, new.tenant_id, new.change_id, new.target_type, new.target_id, new.step,
      new.step_order, new.action_required, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.change_id, old.target_type, old.target_id, old.step,
      old.step_order, old.action_required, old.created_at) then
    raise exception 'Only an impact''s resolution can change.' using errcode = 'check_violation';
  end if;
  if new.resolved_at is null then
    new.resolved_by := null;
    return new;
  end if;

  new.resolved_at := now();
  new.resolved_by := coalesce(auth.uid(), new.resolved_by);

  if new.step is not null then
    select count(*) into v_evidence
      from public.ms_evidence e
     where e.tenant_id = new.tenant_id and e.subject_type = 'ms_change_impact'
       and e.subject_id = new.id and e.superseded_by is null;
    if v_evidence = 0 then
      raise exception 'Attach evidence for this step first.' using errcode = 'check_violation';
    end if;
    if new.step = 'confirm_holder' then
      select holder_of_record into v_holder
        from public.environmental_permits
       where tenant_id = new.tenant_id and id = new.target_id;
      if v_holder is null
         or public.ms_normalize_legal_entity(v_holder) <> public.ms_normalize_legal_entity(v_change.new_legal_entity) then
        raise exception 'The permit still names another holder. Update its holder of record to the new legal entity first.'
          using errcode = 'check_violation';
      end if;
    end if;

  elsif new.target_type in ('scope', 'policy') then
    -- The impact points at one version; the series it belongs to is that version's discipline.
    if new.target_type = 'scope' then
      select discipline into v_discipline from public.ms_scope_statements
       where tenant_id = new.tenant_id and id = new.target_id;
    else
      select discipline into v_discipline from public.ms_policies
       where tenant_id = new.tenant_id and id = new.target_id;
    end if;
    select legal_entity, effective_from into v_scope_entity, v_scope_from
      from public.ms_scope_statements
     where tenant_id = new.tenant_id and discipline = v_discipline
     order by version desc
     limit 1;
    if v_scope_entity is null
       or public.ms_normalize_legal_entity(v_scope_entity) <> public.ms_normalize_legal_entity(v_change.new_legal_entity) then
      raise exception 'The scope in force does not name the new legal entity yet. Issue a new scope version first.'
        using errcode = 'check_violation';
    end if;
    if new.target_type = 'policy' then
      select signed_at into v_policy_signed
        from public.ms_policies
       where tenant_id = new.tenant_id and discipline = v_discipline
       order by version desc
       limit 1;
      if v_policy_signed is null or v_policy_signed < v_scope_from then
        raise exception 'The policy in force was signed before the scope named the new legal entity. Have it signed again first.'
          using errcode = 'check_violation';
      end if;
    end if;

  elsif new.resolution_note is null or length(btrim(new.resolution_note)) = 0 then
    raise exception 'Say what was done.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_ms_change_impacts_guard on public.ms_change_impacts;
create trigger trg_ms_change_impacts_guard
  before insert or update on public.ms_change_impacts
  for each row execute function public.ms_change_impacts_guard();

-- ── Opening a change with its impacts, in one transaction (D12) ─────────
-- Invoker, so RLS applies: only an admin can open one, and a target the
-- caller cannot see (another tenant's, or another site's when a site is
-- selected) is refused rather than stored.
create or replace function public.ms_open_change(p_change jsonb, p_impacts jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_tenant    uuid := (p_change->>'tenant_id')::uuid;
  v_change_id uuid;
  v_impact    jsonb;
  v_target    uuid;
  v_exists    boolean;
begin
  insert into public.ms_changes
    (tenant_id, facility_id, discipline, kind, title, description, process_area, new_legal_entity, effective_on)
  values (
    v_tenant,
    nullif(p_change->>'facility_id', '')::uuid,
    coalesce(p_change->>'discipline', 'ems'),
    p_change->>'kind',
    p_change->>'title',
    p_change->>'description',
    nullif(btrim(coalesce(p_change->>'process_area', '')), ''),
    nullif(btrim(coalesce(p_change->>'new_legal_entity', '')), ''),
    nullif(p_change->>'effective_on', '')::date)
  returning id into v_change_id;

  for v_impact in select value from jsonb_array_elements(coalesce(p_impacts, '[]'::jsonb)) loop
    v_target := (v_impact->>'target_id')::uuid;
    v_exists := case v_impact->>'target_type'
      when 'permit'     then exists (select 1 from public.environmental_permits           where tenant_id = v_tenant and id = v_target)
      when 'scope'      then exists (select 1 from public.ms_scope_statements             where tenant_id = v_tenant and id = v_target)
      when 'policy'     then exists (select 1 from public.ms_policies                     where tenant_id = v_tenant and id = v_target)
      when 'aspect'     then exists (select 1 from public.environmental_aspects           where tenant_id = v_tenant and id = v_target)
      when 'obligation' then exists (select 1 from public.compliance_calendar_obligations where tenant_id = v_tenant and id = v_target)
      when 'objective'  then exists (select 1 from public.environmental_objectives        where tenant_id = v_tenant and id = v_target)
      else false
    end;
    if not v_exists then
      raise exception 'Impact target % % is not a record of this organization.', v_impact->>'target_type', v_target
        using errcode = 'foreign_key_violation';
    end if;
    insert into public.ms_change_impacts (tenant_id, change_id, target_type, target_id, step, step_order, action_required)
    values (v_tenant, v_change_id, v_impact->>'target_type', v_target, nullif(v_impact->>'step', ''),
            coalesce((v_impact->>'step_order')::smallint, 0), v_impact->>'action_required');
  end loop;
  return v_change_id;
end $$;
revoke all on function public.ms_open_change(jsonb, jsonb) from public, anon;
grant execute on function public.ms_open_change(jsonb, jsonb) to authenticated;

-- ── RLS: member read, admin write; nothing is deleted by a client ───────
alter table public.ms_changes        enable row level security;
alter table public.ms_change_impacts enable row level security;

drop policy if exists ms_changes_member_read on public.ms_changes;
create policy ms_changes_member_read on public.ms_changes
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );
drop policy if exists ms_changes_admin_write on public.ms_changes;
create policy ms_changes_admin_write on public.ms_changes
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

-- Impacts follow their change, which already carries the site.
drop policy if exists ms_change_impacts_member_read on public.ms_change_impacts;
create policy ms_change_impacts_member_read on public.ms_change_impacts
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );
drop policy if exists ms_change_impacts_admin_write on public.ms_change_impacts;
create policy ms_change_impacts_admin_write on public.ms_change_impacts
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

revoke delete on public.ms_changes, public.ms_change_impacts from authenticated, anon;

-- ── Triggers: touch updated_at, audit every write ────────────────────────
drop trigger if exists trg_ms_changes_touch on public.ms_changes;
create trigger trg_ms_changes_touch
  before update on public.ms_changes
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_ms_changes on public.ms_changes;
create trigger trg_audit_ms_changes
  after insert or update or delete on public.ms_changes
  for each row execute function public.log_audit('id');

drop trigger if exists trg_audit_ms_change_impacts on public.ms_change_impacts;
create trigger trg_audit_ms_change_impacts
  after insert or update or delete on public.ms_change_impacts
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
