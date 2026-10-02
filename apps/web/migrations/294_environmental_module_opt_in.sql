-- Migration 294: make the Environmental (ISO 14001) module opt-in without
-- taking it away from any tenant that uses it today.
--
-- packages/core/src/features.ts now marks `environmental` with
-- `defaultEnabled: false` (docs/ems/adr/0001-build-on-the-existing-
-- environmental-module.md, Q2). From then on a tenant with no
-- `modules.environmental` key no longer sees the module. This migration
-- writes `environmental: true` for every tenant that already has
-- environmental records, so their users keep it.
--
-- Rules:
--   * Explicit overrides win. A tenant that already carries the key, true
--     or false, is untouched.
--   * "Has environmental records" means at least one row in a table the
--     module owns (migrations 204-207).
--
-- Ordering: apply BEFORE deploying the code change, then run it ONCE
-- MORE right after the deploy is live. Who is targeted depends on the rows
-- present when it runs, and until the deploy every keyless tenant can still
-- open the module. The second run catches a tenant that created its first
-- environmental record in between. Skip the first run and the targeted
-- tenants lose the module until it runs.
--
-- Idempotent: a re-run finds every target already carrying the key.
-- The tenants audit trigger records each row this changes.
-- Rollback: 294_rollback.sql.

begin;

update public.tenants t
   set modules = t.modules || jsonb_build_object('environmental', true)
 where not (t.modules ? 'environmental')
   and (
        exists (select 1 from public.environmental_aspects    r where r.tenant_id = t.id)
     or exists (select 1 from public.environmental_objectives r where r.tenant_id = t.id)
     or exists (select 1 from public.nonconformities          r where r.tenant_id = t.id)
     or exists (select 1 from public.management_reviews       r where r.tenant_id = t.id)
     or exists (select 1 from public.iso14001_clause_evidence r where r.tenant_id = t.id)
   );

notify pgrst, 'reload schema';

commit;
