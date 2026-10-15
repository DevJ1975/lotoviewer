-- Migration 294: schema + least-privilege role for the Django platform service.
--
-- services/platform (Django on Fly.io) runs ALONGSIDE Supabase: workers, AI
-- pipelines, precomputed read models, and the internal ops admin. Supabase
-- stays the system of record and these SQL migrations stay the only owner of
-- the `public` schema. Django owns exactly one schema, `platform`, and manages
-- it with its own migrations.
--
-- Why a dedicated role instead of the service-role key:
--   * The service role bypasses RLS on EVERY table. platform_svc gets only the
--     reads it needs, granted table-by-table here so each one is reviewable.
--   * Domain-table RLS policies are written `to authenticated`, so a plain role
--     would see zero rows. Rather than BYPASSRLS, each table below gets an
--     explicit read-only `to platform_svc` policy.
--   * User-scoped work (the MCP server, anything acting for a person) must see
--     exactly what that person sees. platform_svc is a member of
--     `authenticated` so it can `SET LOCAL ROLE authenticated` and replay the
--     user's JWT claims + x-active-tenant header — RLS then applies exactly as
--     it does for PostgREST. The role is NOINHERIT so that membership does NOT
--     silently grant it authenticated's broad table privileges outside an
--     explicit SET ROLE.
--
-- The role is created NOLOGIN: no secret belongs in a migration. Enable it
-- out-of-band (see services/platform/README.md → "Database role"):
--   alter role platform_svc with login password '<from your secret manager>';
--
-- Idempotent: safe to re-run.

begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_svc') then
    create role platform_svc nologin noinherit;
  end if;
end
$$;

alter role platform_svc noinherit;

grant authenticated to platform_svc;

create schema if not exists platform authorization postgres;
grant usage, create on schema platform to platform_svc;
alter default privileges in schema platform
  grant all on tables to platform_svc;
alter default privileges in schema platform
  grant all on sequences to platform_svc;

grant usage on schema public to platform_svc;

-- Read-only access to the tables the ops admin and workers need today. New
-- tables are added here by future migrations, never by a blanket grant.
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenants',
    'tenant_memberships',
    'facilities',
    'profiles',
    'ai_invocations',
    'cron_runs'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'platform_svc grant: public.% does not exist, skipping', t;
      continue;
    end if;

    execute format('grant select on public.%I to platform_svc', t);
    execute format('drop policy if exists %I on public.%I', t || '_platform_svc_read', t);
    execute format(
      'create policy %I on public.%I for select to platform_svc using (true)',
      t || '_platform_svc_read', t
    );
  end loop;
end
$$;

comment on schema platform is
  'Owned by the Django platform service (services/platform). Managed by Django migrations, not by apps/web/migrations.';

commit;
