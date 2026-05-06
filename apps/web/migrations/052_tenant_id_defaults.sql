-- Migration 052: tenant_id column default = public.active_tenant_id().
--
-- Every domain table got a tenant_id column in migration 027 and was
-- locked NOT NULL in migration 029. The intent was that PostgREST
-- inserts would carry the tenant from the x-active-tenant header
-- (parsed by public.active_tenant_id()), but the COLUMN DEFAULT was
-- never wired — so every direct client insert that didn't explicitly
-- set tenant_id failed with:
--
--   null value in column "tenant_id" of relation "loto_devices"
--   violates not-null constraint
--
-- Symptom across the UI:
--   - /admin/loto-devices "Add device" form
--   - /admin/training-records "Add cert" form
--   - /admin/loto-devices Check-out dialog (loto_device_checkouts +
--     loto_training_records inserts)
--
-- Server-side routes (anything going through authedFetch + the tenant
-- gate) were unaffected because they explicitly set tenant_id =
-- gate.tenantId. This migration unifies both paths.
--
-- Self-healing loop: walks every public.* table that carries a
-- tenant_id column (using the same exclusion list as 027/029) and
-- sets the column default. Idempotent — re-running is a no-op.

begin;

do $$
declare
  t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'tenant_id'
       -- Same exclusions as 027 + 029. tenants/tenant_memberships'
       -- tenant_id IS the row identity. audit_log allows nulls
       -- intentionally for cross-tenant superadmin actions.
       and c.table_name not in ('tenants', 'tenant_memberships', 'audit_log')
  loop
    execute format(
      'alter table public.%I alter column tenant_id set default public.active_tenant_id()',
      t
    );
    raise notice 'tenant_id default set on %', t;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
