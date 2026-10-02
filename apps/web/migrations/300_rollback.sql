-- Rollback for migration 300 (facility scoping of the remaining EMS tables).
--
-- Restores the 204-207 policies and drops the facility columns. Facility
-- assignments made since 300 are lost; every row becomes visible from
-- every facility again.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  t text;
begin
  foreach t in array array['environmental_objectives', 'nonconformities', 'management_reviews', 'iso14001_clause_evidence'] loop
    execute format('drop policy if exists %I on public.%I', t || '_tenant_scope', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
        with check (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    $p$, t || '_tenant_scope', t);
    execute format('alter table public.%I drop column if exists facility_id', t);
  end loop;
end $$;

-- Restore the 032 / 209 header readers. They raise again when no request
-- headers are set (SQL Editor, hand-run seeds); see migration 300.
create or replace function public.active_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true),
      ''
    )::jsonb ->> 'x-active-tenant',
    ''
  )::uuid
$$;

create or replace function public.active_facility_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true),
      ''
    )::jsonb ->> 'x-active-facility',
    ''
  )::uuid
$$;

notify pgrst, 'reload schema';

commit;
