-- Migration 032: Honor x-active-tenant header in RLS policies
--
-- Problem: superadmin's tenant-or-superadmin policy from migration 029
-- lets them see EVERY tenant's rows. When the superadmin uses the
-- tenant switcher in the UI, the header pill changes but the dashboard
-- still shows merged data from all tenants.
--
-- Fix: thread an x-active-tenant request header through PostgREST and
-- have RLS scope by it when set. The Supabase JS fetch wrapper in
-- lib/supabase.ts injects the header from sessionStorage on every
-- request; this migration teaches the database to honor it.
--
-- Behavior matrix after this migration:
--
--   user type        | header set | result
--   ---------------- | ---------- | --------------------------------------
--   non-superadmin   | no         | sees their tenants (unchanged)
--   non-superadmin   | yes        | row must match header AND be in their
--                                 |   memberships (header tightens scope)
--   superadmin       | no         | sees all tenants (unchanged — useful
--                                 |   on /superadmin/* cross-tenant pages)
--   superadmin       | yes        | sees only the header tenant — matches
--                                 |   the user's mental model of "switch
--                                 |   to tenant X and work in it"
--
-- The header is OPT-IN: routes that want cross-tenant access (the
-- /superadmin/tenants list, the audit log) can clear sessionStorage's
-- ACTIVE_TENANT_KEY before fetching, and RLS falls back to the
-- migration-029 behavior.
--
-- This migration ONLY touches policies on domain tables — tenants,
-- tenant_memberships, profiles, audit_log policies stay as they were
-- in 029/031. Superadmin still needs unscoped access to those for the
-- tenant switcher and member-management UIs to work.

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: read x-active-tenant from PostgREST request headers.
--
-- current_setting('request.headers', true) returns the JSON object of
-- request headers (lowercased keys) when called from a PostgREST query;
-- returns NULL outside that context (cron, SQL Editor, supabaseAdmin).
-- That NULL is what makes the function "no scope = no scope" — service-
-- role calls and migrations are unaffected by this header logic.
-- ────────────────────────────────────────────────────────────────────────────
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

comment on function public.active_tenant_id() is
  'The tenant_id from the x-active-tenant request header, or NULL when no header was sent (or the JSON parse fails). Used by domain-table RLS to scope superadmin reads.';

-- ────────────────────────────────────────────────────────────────────────────
-- Rewrite *_tenant_scope policies on every domain table to include the
-- header-scoping check.
--
-- Same self-healing loop as migration 029: skip tables that don't
-- exist, keep going on the ones that do.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  t        text;
  pol_name text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    pol_name := t || '_tenant_scope';

    -- Drop the old policy (added by 029).
    execute format('drop policy if exists %I on public.%I', pol_name, t);

    -- Recreate with the header check ANDed onto the existing predicate.
    --   The first predicate = "row's tenant matches the active-tenant
    --   header, OR no header was sent"
    --   The second predicate = "user is member of this tenant OR user
    --   is superadmin" — unchanged from 029
    execute format($pol$
      create policy %I on public.%I
        for all to authenticated
        using (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (
            tenant_id in (select public.current_user_tenant_ids())
            or public.is_superadmin()
          )
        )
        with check (
          (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
          and (
            tenant_id in (select public.current_user_tenant_ids())
            or public.is_superadmin()
          )
        )
    $pol$, pol_name, t);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
