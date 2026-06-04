-- Migration 213: hot-path indexes for the AI budget check + near-miss classify.
--
-- Two indexes, both additive + idempotent (create index if not exists),
-- safe to re-run. No data changes, no locks beyond the brief build.
--
-- 1. ai_invocations: checkTenantBudget() runs on EVERY AI call (before
--    every generate / classify / chat). It sums today's *successful*
--    invocations for the tenant:
--        where tenant_id = $1 and status = 'success' and occurred_at >= $startOfDay
--    The existing idx_ai_invocations_tenant_recent (tenant_id, occurred_at)
--    from mig 047 covers tenant_id + time but not status, so Postgres
--    scans matching rows then filters status. A partial index that
--    pre-filters status='success' is smaller (errors/rate_limited/
--    budget_blocked rows are excluded) and exactly matches the predicate.
--
-- 2. near_misses: the classify route fetches "adjacent" reports in the
--    same hazard category for soft anchoring:
--        where tenant_id = $1 and hazard_category = $2 and id <> $3
--        order by occurred_at desc limit 5
--    Existing near_misses indexes cover (tenant_id) and (tenant_id, status)
--    / (tenant_id, severity) but not hazard_category + occurred_at ordering.

begin;

create index if not exists idx_ai_invocations_tenant_success_recent
  on public.ai_invocations (tenant_id, occurred_at desc)
  where status = 'success';

comment on index public.idx_ai_invocations_tenant_success_recent is
  'Hot path: checkTenantBudget() sums today''s successful invocations per tenant on every AI call. Partial (status=success) keeps it small.';

create index if not exists idx_near_misses_tenant_hazard_recent
  on public.near_misses (tenant_id, hazard_category, occurred_at desc);

comment on index public.idx_near_misses_tenant_hazard_recent is
  'Classify route fetches adjacent same-category reports ordered by recency for AI soft-anchoring.';

commit;
