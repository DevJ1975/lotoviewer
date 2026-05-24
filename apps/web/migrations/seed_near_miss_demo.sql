-- Demo seed — populates the dedicated Near-Miss reporting module for a
-- client walkthrough.
--
-- Distinct from the incident "near_miss" type that feeds the scorecard:
-- this fills the Near-Miss report list (near_misses table) with a
-- reporting-culture spread across hazard categories and statuses.
--
-- The canonical logic lives in public.seed_wls_near_miss_demo()
-- (migration 196) so that "Reset Demo" restores it via seed_wls_demo().
-- This file is a thin, idempotent wrapper for a manual run-once seed.
--
-- Seeds 7 near-miss reports (new / triaged / investigating / closed /
-- escalated_to_risk) spanning mechanical, chemical, electrical,
-- ergonomic, and physical hazards.
--
-- Prereqs:
--   • Migrations through 196 applied (defines the function)
--   • At least one tenant flagged is_demo=true
--   • At least one tenant_membership on the demo tenant

do $$
begin
  raise notice '%', public.seed_wls_near_miss_demo();
end $$;
