-- Demo seed — populates the Behavior-Based Safety (BBS) module for a
-- client walkthrough.
--
-- The canonical logic now lives in public.seed_wls_bbs_demo()
-- (migration 200) so that "Reset Demo" restores it via seed_wls_demo()
-- (the reset wipes bbs_observations, so it must be re-seeded). This file
-- is a thin, idempotent wrapper for a manual run-once seed.
--
-- Seeds 4 QR locations + 8 observations (all three kinds, the full
-- close-out workflow, an anonymous QR submission, and ABC analysis).
--
-- Prereqs:
--   • Migrations through 200 applied (defines the function)
--   • At least one tenant flagged is_demo=true
--   • At least one tenant_membership on the demo tenant

do $$
begin
  raise notice '%', public.seed_wls_bbs_demo();
end $$;
