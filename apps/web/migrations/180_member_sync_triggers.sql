-- Migration 180: Sync writes from profiles + loto_workers into members.
--
-- Why: migration 131 backfilled `members` from `profiles` and
-- `loto_workers` once. Since then every INSERT/UPDATE/DELETE on those
-- two surfaces has drifted the canonical roster — the admin UI and
-- search were showing a snapshot of "the day we ran 131".
--
-- This migration installs three after-row triggers that keep `members`
-- in step with both legacy surfaces. The triggers are guarded with
-- `pg_trigger_depth()` so the existing `members_after_write` trigger
-- (which writes back into member_status_events / member_identifier_hashes)
-- never recurses into the sync path.
--
-- A profile can belong to multiple tenants via tenant_memberships, so
-- the profiles trigger iterates the membership rows and upserts a
-- members row per tenant. A worker has exactly one tenant.
--
-- Soft-delete posture: deleting a profile or worker MUST NOT delete
-- the corresponding members row — many other tables (member_status_events,
-- worker_position_assignments, equipment_operator_authorizations,
-- training records joined by name) carry data that's only meaningful
-- with the member still present. The triggers archive the row instead.
--
-- Idempotent. Safe to re-run.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. profiles → members
--    A profile -> tenant pair is the upsert key. We iterate the
--    user's tenant_memberships so a profile that belongs to three
--    tenants gets three members rows kept in sync.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.sync_profile_to_members()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_profile_id   uuid;
  v_email        text;
  v_full_name    text;
  v_tenant       record;
  v_archived     boolean := tg_op = 'DELETE';
begin
  -- Re-entrancy guard: when members.after_write fires we don't want to
  -- bounce back here. depth=1 means "this trigger is the outermost
  -- trigger in the chain" — i.e. fired by an app write, not by another
  -- trigger.
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if v_archived then
    v_profile_id := old.id;
    -- Archive every member row that points at this profile.
    update public.members
       set status = 'archived',
           profile_id = null,
           metadata = metadata || jsonb_build_object(
             'archived_reason', 'profile_deleted',
             'archived_at', now()::text
           ),
           updated_at = now()
     where profile_id = v_profile_id;
    return old;
  end if;

  v_profile_id := new.id;
  v_email := nullif(lower(trim(coalesce(new.email, ''))), '');
  v_full_name := nullif(trim(coalesce(new.full_name, '')), '');

  for v_tenant in
    select tm.tenant_id
      from public.tenant_memberships tm
     where tm.user_id = v_profile_id
  loop
    -- UPSERT keyed on (tenant_id, profile_id). The unique constraint
    -- on members already enforces this, so ON CONFLICT is exact.
    insert into public.members (
      tenant_id, profile_id, source, legal_name, preferred_name,
      display_name, email, employment_type, status, metadata
    )
    values (
      v_tenant.tenant_id,
      v_profile_id,
      'profile',
      v_full_name,
      v_full_name,
      coalesce(v_full_name, v_email, 'Member'),
      v_email,
      'employee',
      'active',
      jsonb_build_object('synced_from', 'profiles_trigger')
    )
    -- preferred_name and display_name only refresh when display_name_source
    -- is 'system' (the default for sync-created rows). If a user has set a
    -- preferred name explicitly via the UI (display_name_source='user'), we
    -- never clobber it from a profile rename.
    on conflict (tenant_id, profile_id) do update
       set legal_name      = coalesce(excluded.legal_name, public.members.legal_name),
           email           = coalesce(excluded.email, public.members.email),
           preferred_name  = case
                               when public.members.display_name_source = 'user' then public.members.preferred_name
                               else coalesce(excluded.preferred_name, public.members.preferred_name)
                             end,
           display_name    = case
                               when public.members.display_name_source = 'user' then public.members.display_name
                               else coalesce(excluded.display_name, public.members.display_name)
                             end,
           updated_at      = now();
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_sync_profile_to_members on public.profiles;
create trigger trg_sync_profile_to_members
  after insert or update or delete on public.profiles
  for each row execute function public.sync_profile_to_members();

-- ────────────────────────────────────────────────────────────────────
-- 2. loto_workers → members
--    The upsert key is (tenant_id, source='loto_worker', source_id).
--    members has no unique constraint covering that triple, so we run
--    the UPSERT manually with a SELECT-then-INSERT-or-UPDATE.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.sync_loto_worker_to_members()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_worker_id     uuid;
  v_tenant_id     uuid;
  v_existing_id   uuid;
  v_archived      boolean := tg_op = 'DELETE';
  v_active        boolean;
  v_full_name     text;
  v_email         text;
  v_employee_id   text;
  v_notes         text;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if v_archived then
    update public.members
       set status = 'archived',
           metadata = metadata || jsonb_build_object(
             'archived_reason', 'loto_worker_deleted',
             'archived_at', now()::text
           ),
           updated_at = now()
     where source = 'loto_worker'
       and source_id = old.id
       and tenant_id = old.tenant_id;
    return old;
  end if;

  v_worker_id   := new.id;
  v_tenant_id   := new.tenant_id;
  v_active      := coalesce(new.active, true);
  v_full_name   := nullif(trim(coalesce(new.full_name, '')), '');
  v_email       := nullif(lower(trim(coalesce(new.email, ''))), '');
  v_employee_id := nullif(trim(coalesce(new.employee_id, '')), '');
  v_notes       := new.notes;

  select id
    into v_existing_id
    from public.members
   where tenant_id = v_tenant_id
     and source = 'loto_worker'
     and source_id = v_worker_id
   limit 1;

  if v_existing_id is null then
    insert into public.members (
      tenant_id, source, source_id, legal_name, preferred_name,
      display_name, email, employee_id, employment_type, status,
      notes, metadata
    )
    values (
      v_tenant_id,
      'loto_worker',
      v_worker_id,
      v_full_name,
      v_full_name,
      coalesce(v_full_name, v_email, 'Worker'),
      v_email,
      v_employee_id,
      'employee',
      case when v_active then 'active' else 'archived' end,
      v_notes,
      jsonb_build_object('synced_from', 'loto_workers_trigger')
    );
  else
    -- preferred_name/display_name only refresh when display_name_source
    -- is 'system'; never clobber a user-edited preferred name.
    update public.members
       set legal_name      = coalesce(v_full_name, legal_name),
           preferred_name  = case
                               when display_name_source = 'user' then preferred_name
                               else coalesce(v_full_name, preferred_name)
                             end,
           display_name    = case
                               when display_name_source = 'user' then display_name
                               else coalesce(v_full_name, display_name)
                             end,
           email           = coalesce(v_email, email),
           employee_id     = coalesce(v_employee_id, employee_id),
           notes           = coalesce(v_notes, notes),
           status          = case
                               when v_active then
                                 case when status = 'archived' then 'active' else status end
                               else 'archived'
                             end,
           updated_at      = now()
     where id = v_existing_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_loto_worker_to_members on public.loto_workers;
create trigger trg_sync_loto_worker_to_members
  after insert or update or delete on public.loto_workers
  for each row execute function public.sync_loto_worker_to_members();

-- ────────────────────────────────────────────────────────────────────
-- 3. tenant_memberships → members
--    A profile becomes a member of a tenant only after its membership
--    row exists. Without this trigger, an invite that runs the profile
--    insert before the membership insert would never get a members row
--    auto-created (the profiles trigger sees zero memberships).
--    Insert-only — membership role/timestamp updates are not member-
--    relevant, and a membership delete is handled by /api/admin/users
--    DELETE which already archives the member.
-- ────────────────────────────────────────────────────────────────────
create or replace function public.sync_membership_to_members()
  returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_email     text;
  v_full_name text;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select nullif(lower(trim(coalesce(p.email, ''))), ''),
         nullif(trim(coalesce(p.full_name, '')), '')
    into v_email, v_full_name
    from public.profiles p
   where p.id = new.user_id;

  insert into public.members (
    tenant_id, profile_id, source, legal_name, preferred_name,
    display_name, email, employment_type, status, metadata
  )
  values (
    new.tenant_id,
    new.user_id,
    'profile',
    v_full_name,
    v_full_name,
    coalesce(v_full_name, v_email, 'Member'),
    v_email,
    'employee',
    'active',
    jsonb_build_object('synced_from', 'tenant_memberships_trigger',
                       'tenant_role', new.role)
  )
  on conflict (tenant_id, profile_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_membership_to_members on public.tenant_memberships;
create trigger trg_sync_membership_to_members
  after insert on public.tenant_memberships
  for each row execute function public.sync_membership_to_members();

-- These functions are invoked by triggers only — they have no callable
-- shape from PostgREST (return type `trigger`) but Postgres still grants
-- EXECUTE to PUBLIC on create. Revoke explicitly so that the public
-- surface area is exactly what we intend.
revoke all on function public.sync_profile_to_members()      from public, anon, authenticated;
revoke all on function public.sync_loto_worker_to_members()  from public, anon, authenticated;
revoke all on function public.sync_membership_to_members()   from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
