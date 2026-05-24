-- Migration 211: honor x-active-facility in domain-table RLS.
--
-- Extends the header-scoping from migration 032. After this migration each
-- generated <table>_tenant_scope policy filters by facility too:
--
--   active_facility_id() | result
--   -------------------- | -----------------------------------------------
--   NULL (no header)     | roll-up — every facility in the active tenant
--   set                  | that facility's rows + shared (facility_id NULL)
--
-- Symmetric with 032's "no x-active-tenant header => all the user's tenants".
-- A facility_id IS NULL row is visible in BOTH modes — that is the "shared
-- across all facilities" semantics for bucket-B catalog rows (migration 210).
--
-- SAFETY: we ONLY touch tables that (a) carry both tenant_id and facility_id
-- AND (b) already have the generated <table>_tenant_scope policy from 029/032.
-- Tables with custom, hand-written RLS (e.g. toolbox-talk hardening 137,
-- chemical guardrails 094, risk 040) are NOT auto-modified — a second
-- permissive policy would OR with the custom one and silently defeat facility
-- scoping. Those are listed in a NOTICE for targeted, reviewed follow-up.
--
-- A typo in a USING clause makes reads return zero rows for non-superadmins
-- (see 029's warning). After applying, reload the app as a normal member of a
-- multi-facility tenant and confirm the dashboard/lists still show data.
--
-- Idempotent.

begin;

do $$
declare
  t       text;
  custom  text[] := '{}';
  touched text[] := '{}';
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'facility_id'
       and exists (
         select 1 from information_schema.columns c2
          where c2.table_schema = 'public'
            and c2.table_name   = c.table_name
            and c2.column_name  = 'tenant_id'
       )
       and c.table_name <> 'facilities'
  loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename  = t
         and policyname = t || '_tenant_scope'
    ) then
      custom := array_append(custom, t);
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_tenant_scope', t);
    execute format($pol$
      create policy %I on public.%I
        for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (
            tenant_id in (select public.current_user_tenant_ids())
            or public.is_superadmin()
          )
          and (
            public.active_facility_id() is null
            or facility_id = public.active_facility_id()
            or facility_id is null
          )
        )
        with check (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (
            tenant_id in (select public.current_user_tenant_ids())
            or public.is_superadmin()
          )
          and (
            public.active_facility_id() is null
            or facility_id = public.active_facility_id()
            or facility_id is null
          )
        )
    $pol$, t || '_tenant_scope', t);

    touched := array_append(touched, t);
  end loop;

  raise notice 'facility scope added to %s tables: %', coalesce(array_length(touched, 1), 0), touched;
  if array_length(custom, 1) > 0 then
    raise notice 'TABLES WITH CUSTOM RLS — facility scope NOT auto-applied, handle manually: %', custom;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
