-- Rollback for migration 294 (Environmental module opt-in backfill).
--
-- Order matters. FIRST revert the code change that set
-- `defaultEnabled: false` on `environmental` in packages/core/src/features.ts
-- and deploy it, THEN run this. With the code reverted, a missing key means
-- "visible" again, so removing the backfilled key changes nothing anyone
-- sees. Run this while the opt-in code is still live and every tenant it
-- touches loses the module.
--
-- It removes `environmental: true` from the tenants migration 294 targeted:
-- those with environmental records. A tenant a superadmin explicitly
-- switched on after 294 also matches. Under the reverted code that is
-- harmless, because the module is visible to it either way. An explicit
-- `false` is never touched.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

update public.tenants t
   set modules = t.modules - 'environmental'
 where t.modules -> 'environmental' = 'true'::jsonb
   and (
        exists (select 1 from public.environmental_aspects    r where r.tenant_id = t.id)
     or exists (select 1 from public.environmental_objectives r where r.tenant_id = t.id)
     or exists (select 1 from public.nonconformities          r where r.tenant_id = t.id)
     or exists (select 1 from public.management_reviews       r where r.tenant_id = t.id)
     or exists (select 1 from public.iso14001_clause_evidence r where r.tenant_id = t.id)
   );

notify pgrst, 'reload schema';

commit;
