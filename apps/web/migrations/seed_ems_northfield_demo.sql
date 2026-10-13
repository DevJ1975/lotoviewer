-- Demo seed for the EMS (ISO 14001) build: creates the fictional tenant
-- "Northfield Forge & Finish" (Northfield, TX) with the opt-in
-- Environmental module switched on and no other data. Each EMS phase
-- extends this seed with that phase's demo records
-- (docs/ems/EMS_IMPLEMENTATION_PLAN.md, "Phase 0").
--
-- Everything here is invented. Never add a real customer's name, site,
-- permit numbers, findings, or people to this file.
--
-- This is NOT a numbered migration. Run it by hand against a dev or demo
-- database (SQL Editor or psql). It never touches an existing tenant.
--
-- Prereqs: migrations 027 (tenants), 209 (facilities) and 294
-- (Environmental opt-in) applied.
--
-- Idempotent: re-running finds the tenant and its facility already present
-- and changes nothing.

begin;

-- The tenant number comes from the shared sequence, like any superadmin-created
-- tenant. The select list only runs when the slug is absent, so a re-run does
-- not consume a number.
insert into public.tenants (tenant_number, slug, name, status, is_demo, modules)
select public.next_tenant_number(),
       'northfield-forge-demo',
       'Northfield Forge & Finish',
       'active',
       true,
       jsonb_build_object('environmental', true)
 where not exists (
   select 1 from public.tenants where slug = 'northfield-forge-demo'
 );

-- Every tenant needs exactly one primary facility (migrations 209-211).
insert into public.facilities (tenant_id, name, city, state, is_primary)
select t.id, 'Northfield Plant', 'Northfield', 'TX', true
  from public.tenants t
 where t.slug = 'northfield-forge-demo'
   and not exists (
     select 1 from public.facilities f where f.tenant_id = t.id
   );

commit;
