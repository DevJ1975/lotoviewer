-- Migration 184: Member merge — two duplicate members → one.
--
-- An admin who realizes two members rows are the same person calls
-- merge_members(source, target). The source row is marked
-- status='merged' with merged_into_member_id pointing at the target,
-- and every FK currently pointing at the source is re-pointed at the
-- target.
--
-- What gets re-pointed (read each FK target table before adding here):
--   - members.supervisor_member_id (someone reported to the source)
--   - worker_position_assignments.member_id  (added in migration 131)
--   - equipment_operator_authorizations.member_id (added in migration 131)
--   - member_status_events.member_id (preserves history under target)
--   - member_custom_field_values.member_id (carries custom field values
--     forward; on PK conflict the target's value wins)
--   - audit_log.row_pk where table_name='members' (cross-references in
--     audit history)
--
-- What is NOT re-pointed and why:
--   - loto_device_checkouts.worker_id targets loto_workers, not
--     members. Two members can correspond to one loto_workers row only
--     if a bug created duplicate members for the same source — in
--     that case the source's source_id matches the target's source_id
--     and there's nothing to re-point. We leave loto_workers alone in
--     this phase; SCIM and the existing pages keep writing to it, and
--     the 180 sync trigger keeps members in step.
--   - loto_periodic_inspections.authorized_employees_observed is a
--     JSONB array of worker_ids (loto_workers FK), not members. Same
--     reasoning — out of scope for the members-only merge surface.
--   - bbs_observations / bbs_observations_v2 reference loto_workers,
--     not members. Same reasoning.
--   - loto_training_records keys on worker_name text, not member_id.
--     The merge has no FK to re-point there.
--
-- Both members must belong to the same tenant. If both have a non-null
-- profile_id the SP refuses with EXCEPTION — the admin must revoke one
-- login via /api/admin/users DELETE first.
--
-- Idempotent: merging the same source twice raises EXCEPTION; the
-- caller treats that as "already merged".

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. Member merge audit table
-- ────────────────────────────────────────────────────────────────────
create table if not exists public.member_merges (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  source_member_id  uuid not null,
  target_member_id  uuid not null,
  actor_id          uuid references auth.users(id) on delete set null,
  reason            text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_member_merges_target
  on public.member_merges(tenant_id, target_member_id, created_at desc);

alter table public.member_merges enable row level security;

drop policy if exists member_merges_admin_read on public.member_merges;
create policy member_merges_admin_read on public.member_merges
  for select to authenticated
  using (
    public.is_superadmin()
    or tenant_id in (select public.current_user_admin_tenant_ids())
  );

-- Writes only via merge_members() (security definer); no insert policy
-- needed for end users.

drop trigger if exists trg_audit_member_merges on public.member_merges;
create trigger trg_audit_member_merges
  after insert or update or delete on public.member_merges
  for each row execute function public.log_audit('id');

-- ────────────────────────────────────────────────────────────────────
-- 2. Members table additions: merged_into_member_id + status='merged'
-- ────────────────────────────────────────────────────────────────────
alter table public.members
  add column if not exists merged_into_member_id uuid
    references public.members(id) on delete set null;

create index if not exists idx_members_merged_into
  on public.members(merged_into_member_id)
  where merged_into_member_id is not null;

-- Broaden the status check to include 'merged'. The original constraint
-- from 131 was inline-unnamed, so Postgres auto-named it.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.members'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%active%suspended%terminated%archived%'
     and pg_get_constraintdef(oid) not ilike '%merged%'
   limit 1;

  if v_conname is not null then
    execute format('alter table public.members drop constraint %I', v_conname);
  end if;
end;
$$;

-- New check is strictly broader (adds 'merged'); existing rows all
-- satisfy the original set, so no UPDATE-to-fit is needed.
alter table public.members
  add constraint members_status_check
  check (status in ('active','suspended','terminated','archived','merged'));

-- Allow 'merged' in member_status_events.event_type too.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
    from pg_constraint
   where conrelid = 'public.member_status_events'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%event_type%'
     and pg_get_constraintdef(oid) not ilike '%merged%'
   limit 1;

  if v_conname is not null then
    execute format('alter table public.member_status_events drop constraint %I', v_conname);
  end if;
end;
$$;

alter table public.member_status_events
  add constraint member_status_events_event_type_check
  check (event_type in (
    'created','updated','status_changed','role_changed','readiness_changed',
    'login_granted','login_revoked','imported','merged'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 3. merge_members() — the stored procedure
-- ────────────────────────────────────────────────────────────────────
create or replace function public.merge_members(
  p_source_id uuid,
  p_target_id uuid,
  p_actor_id  uuid,
  p_reason    text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_source public.members%rowtype;
  v_target public.members%rowtype;
begin
  if p_source_id = p_target_id then
    raise exception 'source and target member ids must differ';
  end if;

  select * into v_source from public.members where id = p_source_id for update;
  if not found then
    raise exception 'source member % not found', p_source_id;
  end if;

  select * into v_target from public.members where id = p_target_id for update;
  if not found then
    raise exception 'target member % not found', p_target_id;
  end if;

  if v_source.tenant_id <> v_target.tenant_id then
    raise exception 'source and target must belong to the same tenant';
  end if;

  if v_source.status = 'merged' then
    raise exception 'source member % is already merged into %',
      p_source_id, v_source.merged_into_member_id;
  end if;
  if v_target.status = 'merged' then
    raise exception 'target member % is already merged into %',
      p_target_id, v_target.merged_into_member_id;
  end if;

  -- Defence in depth: API layer also blocks this with 409.
  if v_source.profile_id is not null and v_target.profile_id is not null then
    raise exception 'both members have login (profile_id) set; revoke one before merging';
  end if;

  -- Re-point FKs.
  update public.members
     set supervisor_member_id = p_target_id, updated_at = now()
   where supervisor_member_id = p_source_id;

  update public.worker_position_assignments
     set member_id = p_target_id
   where member_id = p_source_id;

  update public.equipment_operator_authorizations
     set member_id = p_target_id
   where member_id = p_source_id;

  update public.member_status_events
     set member_id = p_target_id
   where member_id = p_source_id;

  -- member_custom_field_values has (member_id, field_id) as PK; carry
  -- the source's values forward only when the target doesn't already
  -- own that field.
  update public.member_custom_field_values v
     set member_id = p_target_id
   where v.member_id = p_source_id
     and not exists (
       select 1 from public.member_custom_field_values t
        where t.member_id = p_target_id and t.field_id = v.field_id
     );
  -- Drop any source values the target already has — target wins.
  delete from public.member_custom_field_values
   where member_id = p_source_id;

  -- audit_log row_pk is text. Re-point so historical audit rows for
  -- the source now reference the target as well; the operation chain
  -- on the source is still recoverable via member_merges.
  update public.audit_log
     set row_pk = p_target_id::text
   where table_name = 'members'
     and row_pk = p_source_id::text;

  -- Mark the source as merged. Keep the row — many downstream rows
  -- can still reference it by source_id (loto_worker pivot) and we
  -- want a stable redirect.
  update public.members
     set status = 'merged',
         merged_into_member_id = p_target_id,
         updated_at = now()
   where id = p_source_id;

  -- Audit + member_status_events trail.
  insert into public.member_merges (
    tenant_id, source_member_id, target_member_id, actor_id, reason
  ) values (
    v_source.tenant_id, p_source_id, p_target_id, p_actor_id, p_reason
  );

  insert into public.member_status_events (
    tenant_id, member_id, event_type, actor_user_id, reason,
    old_values, new_values
  ) values (
    v_target.tenant_id, p_target_id, 'merged', p_actor_id, p_reason,
    jsonb_build_object('source_member_id', p_source_id),
    jsonb_build_object('target_member_id', p_target_id)
  );

  return p_target_id;
end;
$$;

-- Why service_role only: this SP is destructive (re-points FKs, marks
-- a member merged). The /api/admin/members/merge route uses the service
-- client and gates with requireTenantAdmin; granting execute to
-- `authenticated` would let any logged-in user invoke it directly via
-- supabase.rpc(), bypassing the route's admin check. Keep the surface
-- single: the route is the only caller.
revoke all on function public.merge_members(uuid, uuid, uuid, text) from public;
revoke all on function public.merge_members(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.merge_members(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;
