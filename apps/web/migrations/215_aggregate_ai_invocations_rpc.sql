-- Migration 215: aggregate_ai_invocations_for_report() RPC.
--
-- The /api/cron/superadmin-daily-report job pulls ~24h of
-- ai_invocations rows into Node to roll up per-tenant / per-model /
-- per-status counts + sums. On a busy day that meant tens of thousands
-- of rows shipped across the wire and aggregated in JS. The prior
-- mitigation lowered the row ceiling 50k→20k and added a Sentry-warn
-- on a limit hit; this migration makes the rollup unnecessary by
-- pushing the GROUP BY into Postgres.
--
-- The cost math (cache discounts at 10% / 25% etc.) stays in JS so
-- pricing changes are a one-place edit in usageAggregator.ts.
--
-- Cardinality after aggregation: tenants × models × statuses — a few
-- hundred rows in the worst case, vs 20k+ before. Per-tenant cap-pct
-- calculation in the cron then just iterates pre-summed buckets.

begin;

create or replace function public.aggregate_ai_invocations_for_report(p_since timestamptz)
  returns table (
    tenant_id           uuid,
    model               text,
    status              text,
    invocations         bigint,
    input_tokens        bigint,
    output_tokens       bigint,
    cache_read_tokens   bigint,
    cache_write_tokens  bigint
  )
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    tenant_id,
    model,
    status,
    count(*)::bigint                              as invocations,
    coalesce(sum(input_tokens),       0)::bigint  as input_tokens,
    coalesce(sum(output_tokens),      0)::bigint  as output_tokens,
    coalesce(sum(cache_read_tokens),  0)::bigint  as cache_read_tokens,
    coalesce(sum(cache_write_tokens), 0)::bigint  as cache_write_tokens
  from public.ai_invocations
  where occurred_at >= p_since
  group by tenant_id, model, status;
$$;

comment on function public.aggregate_ai_invocations_for_report(timestamptz) is
  'Per-(tenant, model, status) rollup of ai_invocations since p_since. Used by /api/cron/superadmin-daily-report to avoid pulling 20k+ raw rows for what is a fixed-cardinality GROUP BY.';

-- The cron uses the service-role client, which bypasses RLS — but we
-- also expose this to authenticated callers in case a tenant-side
-- variant ever wants the same shape. RLS on ai_invocations restricts
-- what they can see; the function inherits that posture via
-- security invoker.
revoke all on function public.aggregate_ai_invocations_for_report(timestamptz) from public;
grant execute on function public.aggregate_ai_invocations_for_report(timestamptz) to authenticated;

commit;
