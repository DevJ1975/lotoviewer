-- Migration 296: no permit is issued until every worker on it holds a
-- current pass of the training its permit type requires.
--
-- Before this, permit pages ran a soft, name-matched check against
-- loto_training_records that a supervisor could tick past, and nothing
-- in the database enforced it. Confined-space entrants and hot-work
-- operators were free-text names, so they could not be checked at all.
--
-- Model:
--   permit_workers            roster members (members.id) on a permit, by
--                             role. The legacy text[] name columns stay for
--                             printing and history; this table is the
--                             gateable truth.
--   strike_training_requirements (114) with required_before_start = true
--                             says which STRIKE modules a permit type
--                             needs. Admins configure it on /strike/admin.
--   permit_training_status()  per crew member per requirement:
--                             current | missing | overridden. Used by the
--                             permit page panel AND the triggers, so the
--                             UI and the gate cannot disagree.
--   permit_training_overrides audited emergency override: owner/admin
--                             only, a written reason, append-only.
--
-- Enforcement is BEFORE triggers at the moment of issue — the signature
-- column going null → set (confined space, hot work), status becoming
-- 'active' (working at heights), and the group permit / member insert
-- (LOTO). Triggers cover every write path at once: the browser client,
-- the API routes, and the AI operator's carve-out appliers.
--
-- "Current" mirrors isStrikeCompletionCurrent (packages/core/src/strike.ts):
-- passed, not expired, within the requirement's expires_after_days, pinned
-- to the requirement's version when it names one, and at or above the
-- module's supersession floor (migration 294).
--
-- A permit type with no required_before_start requirement is not gated,
-- so this migration changes nothing until an admin configures one.
--
-- Idempotent.

begin;

-- ── Requirement sources gain the remaining permit types ────────────────

alter table public.strike_training_requirements
  drop constraint if exists strike_training_requirements_source_type_check;
alter table public.strike_training_requirements
  add constraint strike_training_requirements_source_type_check
  check (source_type in (
    'loto', 'confined_space', 'hot_work', 'working_at_heights', 'pre_job',
    'jha', 'chemical', 'bbs', 'incident', 'incident_action', 'safety_board',
    'manual', 'equipment_readiness', 'custom'
  ));

-- ── Crew ────────────────────────────────────────────────────────────────

create table if not exists public.permit_workers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  permit_type  text not null check (permit_type in ('confined_space', 'hot_work', 'working_at_heights', 'loto_group')),
  permit_id    uuid not null,
  member_id    uuid not null references public.members(id) on delete restrict,
  role         text not null check (role in (
                 'entrant', 'attendant', 'entry_supervisor', 'operator', 'fire_watch',
                 'worker', 'competent_person', 'authorized_employee'
               )),
  added_by     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  unique (permit_type, permit_id, member_id, role)
);

create index if not exists permit_workers_permit_idx on public.permit_workers(tenant_id, permit_type, permit_id);
create index if not exists permit_workers_member_idx on public.permit_workers(tenant_id, member_id);

comment on table public.permit_workers is
  'Roster members on a permit, by role. The gateable crew list; legacy text[] name columns are kept in sync for print and history.';

alter table public.permit_workers enable row level security;

drop policy if exists permit_workers_tenant_scope on public.permit_workers;
create policy permit_workers_tenant_scope on public.permit_workers
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists permit_workers_audit on public.permit_workers;
create trigger permit_workers_audit
  after insert or update or delete on public.permit_workers
  for each row execute function public.log_audit('id');

-- ── Overrides ───────────────────────────────────────────────────────────

create table if not exists public.permit_training_overrides (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  permit_type  text not null check (permit_type in ('confined_space', 'hot_work', 'working_at_heights', 'loto_group')),
  permit_id    uuid not null,
  member_ids   uuid[] not null check (cardinality(member_ids) > 0),
  reason       text not null check (length(btrim(reason)) >= 20),
  granted_by   uuid not null references auth.users(id) on delete restrict,
  granted_at   timestamptz not null default now()
);

create index if not exists permit_training_overrides_permit_idx
  on public.permit_training_overrides(tenant_id, permit_type, permit_id);

comment on table public.permit_training_overrides is
  'Audited emergency override of the permit training gate. Owner/admin only, written reason required, append-only (no update/delete policy). Every insert is audit-logged and EHS is notified by /api/permits/training-override.';

alter table public.permit_training_overrides enable row level security;

drop policy if exists permit_training_overrides_read on public.permit_training_overrides;
create policy permit_training_overrides_read on public.permit_training_overrides
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

drop policy if exists permit_training_overrides_insert on public.permit_training_overrides;
create policy permit_training_overrides_insert on public.permit_training_overrides
  for insert to authenticated
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and granted_by = auth.uid()
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

drop trigger if exists permit_training_overrides_audit on public.permit_training_overrides;
create trigger permit_training_overrides_audit
  after insert or update or delete on public.permit_training_overrides
  for each row execute function public.log_audit('id');

-- ── Status ──────────────────────────────────────────────────────────────

create or replace function public.permit_requirement_source(p_permit_type text)
returns text
language sql
immutable
as $$
  select case p_permit_type
    when 'confined_space'     then 'confined_space'
    when 'hot_work'           then 'hot_work'
    when 'working_at_heights' then 'working_at_heights'
    when 'loto_group'         then 'loto'
  end
$$;

create or replace function public.permit_type_is_gated(p_tenant_id uuid, p_permit_type text, p_permit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.strike_training_requirements r
     where r.tenant_id = p_tenant_id
       and r.active
       and r.required_before_start
       and r.source_type = public.permit_requirement_source(p_permit_type)
       and (r.source_id is null or r.source_id = p_permit_id)
  )
$$;

create or replace function public.member_for_profile(p_tenant_id uuid, p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.members where tenant_id = p_tenant_id and profile_id = p_profile_id limit 1
$$;

create or replace function public.permit_training_status(
  p_tenant_id        uuid,
  p_permit_type      text,
  p_permit_id        uuid,
  p_extra_member_ids uuid[] default '{}'
)
returns table (
  member_id    uuid,
  display_name text,
  module_id    uuid,
  module_title text,
  status       text,
  expires_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Security definer reads other people's completions, so an end-user
  -- caller must belong to the tenant. Trigger and service-role contexts
  -- carry no end-user role claim and pass straight through.
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon')
     and not (p_tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  then
    raise exception 'Not a member of this tenant' using errcode = 'insufficient_privilege';
  end if;

  return query
  with reqs as (
    select r.module_id, r.module_version_id, r.expires_after_days, m.title
      from public.strike_training_requirements r
      join public.strike_modules m on m.id = r.module_id
     where r.tenant_id = p_tenant_id
       and r.active
       and r.required_before_start
       and r.source_type = public.permit_requirement_source(p_permit_type)
       and (r.source_id is null or r.source_id = p_permit_id)
  ),
  crew as (
    select pw.member_id
      from public.permit_workers pw
     where pw.tenant_id = p_tenant_id and pw.permit_type = p_permit_type and pw.permit_id = p_permit_id
    union
    select x.member_id from unnest(p_extra_member_ids) as x(member_id) where x.member_id is not null
  ),
  overridden as (
    select distinct x.member_id
      from public.permit_training_overrides o, unnest(o.member_ids) as x(member_id)
     where o.tenant_id = p_tenant_id and o.permit_type = p_permit_type and o.permit_id = p_permit_id
  ),
  floors as (
    select v.module_id,
           coalesce(max(v.version_number) filter (where v.supersedes_completions), 1) as floor
      from public.strike_module_versions v
     where v.status in ('published', 'superseded')
     group by v.module_id
  ),
  best as (
    select c.member_id, r.module_id, max(sc.expires_at) as expires_at, count(sc.id) as passes,
           bool_or(sc.expires_at is null) as never_expires
      from crew c
      cross join reqs r
      join public.members mem on mem.id = c.member_id
      left join public.strike_completions sc
        on sc.tenant_id = p_tenant_id
       and sc.passed
       and sc.module_id = r.module_id
       and (sc.member_id = c.member_id or (mem.profile_id is not null and sc.user_id = mem.profile_id))
       and (sc.expires_at is null or sc.expires_at > now())
       and (r.expires_after_days is null or sc.completed_at > now() - make_interval(days => r.expires_after_days))
       and (r.module_version_id is null or sc.module_version_id = r.module_version_id)
       and exists (
             select 1 from public.strike_module_versions sv
              left join floors f on f.module_id = sv.module_id
              where sv.id = sc.module_version_id and sv.version_number >= coalesce(f.floor, 1)
           )
     group by c.member_id, r.module_id
  )
  select b.member_id,
         mem.display_name,
         b.module_id,
         r.title,
         case
           when b.passes > 0 then 'current'
           when b.member_id in (select o.member_id from overridden o) then 'overridden'
           else 'missing'
         end,
         case when b.never_expires then null else b.expires_at end
    from best b
    join reqs r on r.module_id = b.module_id
    join public.members mem on mem.id = b.member_id
   order by mem.display_name, r.title;
end;
$$;

revoke execute on function public.permit_training_status(uuid, text, uuid, uuid[]) from anon, public;
grant  execute on function public.permit_training_status(uuid, text, uuid, uuid[]) to authenticated, service_role;

create or replace function public.assert_permit_training(
  p_tenant_id        uuid,
  p_permit_type      text,
  p_permit_id        uuid,
  p_extra_member_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing int;
  v_summary text;
begin
  select count(*), string_agg(s.display_name || ' — ' || s.module_title, '; ' order by s.display_name)
    into v_missing, v_summary
    from public.permit_training_status(p_tenant_id, p_permit_type, p_permit_id, p_extra_member_ids) s
   where s.status = 'missing';

  if v_missing > 0 then
    raise exception 'TRAINING_REQUIRED: required training is missing for %', v_summary
      using errcode = 'check_violation',
            hint = 'Each worker can complete it now with "Train now" on the permit, or an owner/admin may record an audited emergency override.';
  end if;
end;
$$;

revoke execute on function public.assert_permit_training(uuid, text, uuid, uuid[]) from anon, public;

-- ── Enforcement triggers ───────────────────────────────────────────────

create or replace function public.gate_confined_space_permit_issue()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.entry_supervisor_signature_at is not null
     and (tg_op = 'INSERT' or old.entry_supervisor_signature_at is null)
  then
    perform public.assert_permit_training(
      new.tenant_id, 'confined_space', new.id,
      array[public.member_for_profile(new.tenant_id, new.entry_supervisor_id)]
    );
  end if;
  return new;
end;
$$;

drop trigger if exists confined_space_permit_training_gate on public.loto_confined_space_permits;
create trigger confined_space_permit_training_gate
  before insert or update of entry_supervisor_signature_at on public.loto_confined_space_permits
  for each row execute function public.gate_confined_space_permit_issue();

create or replace function public.gate_hot_work_permit_issue()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.pai_signature_at is not null
     and (tg_op = 'INSERT' or old.pai_signature_at is null)
  then
    perform public.assert_permit_training(
      new.tenant_id, 'hot_work', new.id,
      array[public.member_for_profile(new.tenant_id, new.pai_id)]
    );
  end if;
  return new;
end;
$$;

drop trigger if exists hot_work_permit_training_gate on public.loto_hot_work_permits;
create trigger hot_work_permit_training_gate
  before insert or update of pai_signature_at on public.loto_hot_work_permits
  for each row execute function public.gate_hot_work_permit_issue();

-- Working-at-heights permits are issued straight into 'active' on insert,
-- before any permit_workers row can reference them, so the worker and the
-- competent person — both already roster ids — are passed in directly.
create or replace function public.gate_wah_permit_issue()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform public.assert_permit_training(new.tenant_id, 'working_at_heights', new.id, array[new.worker_id, new.cp_id]);
  end if;
  return new;
end;
$$;

drop trigger if exists wah_permit_training_gate on public.wah_permits;
create trigger wah_permit_training_gate
  before insert or update of status on public.wah_permits
  for each row execute function public.gate_wah_permit_issue();

create or replace function public.gate_loto_group_permit_issue()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.assert_permit_training(
    new.tenant_id, 'loto_group', new.id,
    array[public.member_for_profile(new.tenant_id, new.primary_authorized_employee_id)]
  );
  return new;
end;
$$;

drop trigger if exists loto_group_permit_training_gate on public.loto_group_permits;
create trigger loto_group_permit_training_gate
  before insert on public.loto_group_permits
  for each row execute function public.gate_loto_group_permit_issue();

-- Each worker who hangs a personal lock on the group box is gated as they
-- join. Shop-floor workers are mapped to their roster entry through the
-- loto_worker source link (migration 131).
create or replace function public.gate_loto_group_member_join()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_member uuid;
begin
  select tenant_id into v_tenant from public.loto_group_permits where id = new.group_permit_id;
  if not public.permit_type_is_gated(v_tenant, 'loto_group', new.group_permit_id) then
    return new;
  end if;

  if new.user_id is not null then
    v_member := public.member_for_profile(v_tenant, new.user_id);
  else
    select id into v_member from public.members
     where tenant_id = v_tenant and source = 'loto_worker' and source_id = new.worker_id
     limit 1;
  end if;

  if v_member is null then
    raise exception 'TRAINING_REQUIRED: this worker is not on the roster, so their training cannot be verified'
      using errcode = 'check_violation',
            hint = 'Add them to People first, then complete the required training.';
  end if;

  perform public.assert_permit_training(v_tenant, 'loto_group', new.group_permit_id, array[v_member]);
  return new;
end;
$$;

drop trigger if exists loto_group_member_training_gate on public.loto_group_permit_members;
create trigger loto_group_member_training_gate
  before insert on public.loto_group_permit_members
  for each row execute function public.gate_loto_group_member_join();

-- Crew added after issue (mid-job roster changes) is gated the same way,
-- or an untrained entrant could simply be added once the permit is signed.
create or replace function public.gate_permit_worker_join()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_issued boolean;
begin
  v_issued := case new.permit_type
    when 'confined_space' then exists (
      select 1 from public.loto_confined_space_permits
       where id = new.permit_id and entry_supervisor_signature_at is not null and canceled_at is null)
    when 'hot_work' then exists (
      select 1 from public.loto_hot_work_permits
       where id = new.permit_id and pai_signature_at is not null and canceled_at is null)
    when 'working_at_heights' then exists (
      select 1 from public.wah_permits where id = new.permit_id and status = 'active')
    else false
  end;

  if v_issued then
    perform public.assert_permit_training(new.tenant_id, new.permit_type, new.permit_id, array[new.member_id]);
  end if;
  return new;
end;
$$;

drop trigger if exists permit_workers_training_gate on public.permit_workers;
create trigger permit_workers_training_gate
  before insert on public.permit_workers
  for each row execute function public.gate_permit_worker_join();

notify pgrst, 'reload schema';

commit;
