-- Demo seed — populates the incident module for a client walkthrough.
--
-- The canonical logic now lives in public.seed_wls_incidents_demo()
-- (migration 200) so that "Reset Demo" restores it via seed_wls_demo().
-- This file is a thin, idempotent wrapper for a manual run-once seed.
--
-- Seeds 13 incidents (3 OSHA-recordable) and 10 investigations spanning
-- all four RCA methods, reconciled with the EHS scorecard:
--   TRIR ≈ 6.2, DART ≈ 4.1, near-miss:recordable ratio 2.0, RCA completion ≈ 67%.
--
-- Prereqs:
--   • Migrations through 200 applied (defines the function)
--   • At least one tenant flagged is_demo=true
--   • At least one tenant_membership on the demo tenant

do $$
begin
  raise notice '%', public.seed_wls_incidents_demo();
end $$;
