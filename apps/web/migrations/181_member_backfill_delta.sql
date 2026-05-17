-- Migration 181: Idempotent delta backfill for members.
--
-- Migration 131 ran the initial backfill once. Anything that landed in
-- profiles or loto_workers between 131 and the trigger install in 180
-- is missing from members. This function replays the same logic as
-- 131's two backfill statements but only for rows that don't already
-- have a members entry.
--
-- The /superadmin/identity-drift page calls this per-tenant when an
-- admin clicks "Reconcile" on a finding. The function is also safe to
-- call ad-hoc from psql.

begin;

create or replace function public.reconcile_members_backfill(
  p_tenant_id uuid default null
)
returns table (inserted_count int, updated_count int)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
  v_count    int;
begin
  -- Profiles missing a members row in tenants where they are a
  -- member. Mirrors the 131 backfill but joins on absence.
  with seed as (
    insert into public.members (
      tenant_id, profile_id, source, legal_name, preferred_name,
      display_name, email, employment_type, status, created_by, metadata
    )
    select
      tm.tenant_id,
      p.id,
      'profile',
      p.full_name,
      p.full_name,
      coalesce(nullif(trim(p.full_name), ''), p.email, 'Member'),
      nullif(lower(trim(coalesce(p.email, ''))), ''),
      'employee',
      'active',
      tm.invited_by,
      jsonb_build_object('synced_from', 'reconcile_members_backfill',
                         'tenant_role', tm.role)
    from public.tenant_memberships tm
    join public.profiles p on p.id = tm.user_id
    where (p_tenant_id is null or tm.tenant_id = p_tenant_id)
      and not exists (
        select 1 from public.members m
         where m.tenant_id = tm.tenant_id
           and m.profile_id = p.id
      )
    returning 1
  )
  select count(*) into v_count from seed;
  v_inserted := v_inserted + coalesce(v_count, 0);

  -- LOTO workers missing a members row. The match is exact on
  -- source/source_id; no fuzzy reconciliation here (that's the merge
  -- flow's job).
  with seed as (
    insert into public.members (
      tenant_id, source, source_id, legal_name, preferred_name,
      display_name, email, employee_id, employment_type, status,
      notes, created_by, metadata
    )
    select
      w.tenant_id,
      'loto_worker',
      w.id,
      w.full_name,
      w.full_name,
      coalesce(nullif(trim(w.full_name), ''), w.email, 'Worker'),
      nullif(lower(trim(coalesce(w.email, ''))), ''),
      nullif(trim(coalesce(w.employee_id, '')), ''),
      'employee',
      case when w.active then 'active' else 'archived' end,
      w.notes,
      w.created_by,
      jsonb_build_object('synced_from', 'reconcile_members_backfill')
    from public.loto_workers w
    where (p_tenant_id is null or w.tenant_id = p_tenant_id)
      and not exists (
        select 1 from public.members m
         where m.tenant_id = w.tenant_id
           and m.source = 'loto_worker'
           and m.source_id = w.id
      )
    returning 1
  )
  select count(*) into v_count from seed;
  v_inserted := v_inserted + coalesce(v_count, 0);

  -- Refresh email/name on existing members where the source row
  -- diverged. Cheap to re-run; only touches rows that actually drifted.
  with refreshed as (
    update public.members m
       set legal_name = p.full_name,
           email      = nullif(lower(trim(coalesce(p.email, ''))), ''),
           updated_at = now()
      from public.profiles p
     where m.profile_id = p.id
       and m.source = 'profile'
       and (p_tenant_id is null or m.tenant_id = p_tenant_id)
       and (
         coalesce(m.legal_name, '') is distinct from coalesce(p.full_name, '')
         or coalesce(m.email, '') is distinct from coalesce(nullif(lower(trim(coalesce(p.email, ''))), ''), '')
       )
     returning 1
  )
  select count(*) into v_count from refreshed;
  v_updated := v_updated + coalesce(v_count, 0);

  with refreshed as (
    update public.members m
       set legal_name  = w.full_name,
           email       = nullif(lower(trim(coalesce(w.email, ''))), ''),
           employee_id = nullif(trim(coalesce(w.employee_id, '')), ''),
           updated_at  = now()
      from public.loto_workers w
     where m.source = 'loto_worker'
       and m.source_id = w.id
       and m.tenant_id = w.tenant_id
       and (p_tenant_id is null or m.tenant_id = p_tenant_id)
       and (
         coalesce(m.legal_name, '')  is distinct from coalesce(w.full_name, '')
         or coalesce(m.email, '')      is distinct from coalesce(nullif(lower(trim(coalesce(w.email, ''))), ''), '')
         or coalesce(m.employee_id, '') is distinct from coalesce(nullif(trim(coalesce(w.employee_id, '')), ''), '')
       )
     returning 1
  )
  select count(*) into v_count from refreshed;
  v_updated := v_updated + coalesce(v_count, 0);

  return query select v_inserted, v_updated;
end;
$$;

-- Service-role only: the SP writes to members on behalf of a tenant
-- without re-checking the caller's admin status. The drift API route
-- is the only intended caller; it gates with requireSuperadmin and
-- uses the service client. `anon` gets its own grant on creation, so
-- revoking from public alone isn't enough.
revoke all on function public.reconcile_members_backfill(uuid) from public;
revoke all on function public.reconcile_members_backfill(uuid) from anon;
revoke all on function public.reconcile_members_backfill(uuid) from authenticated;
grant execute on function public.reconcile_members_backfill(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
