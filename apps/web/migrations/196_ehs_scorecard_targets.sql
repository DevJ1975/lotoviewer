-- Migration 196: EHS scorecard goals + industry-benchmark overrides.
--
-- One small admin-scoped table backs two related scorecard features:
--   • kind='target'    — a tenant's goal for a metric in a given year
--                        (e.g. TRIR ≤ 2.0 in 2026). Drives the target
--                        line on the year-over-year chart + progress-to-
--                        goal chips on the stat cards.
--   • kind='benchmark' — a tenant's override of the built-in BLS industry
--                        average for a metric (year-agnostic). The app
--                        ships BLS-by-NAICS defaults in core; this row
--                        only exists when an admin types their own figure.
--
-- Both shapes are (tenant, metric, value), so they share one table and
-- one RLS policy. Targets are unique per (tenant, metric, year);
-- benchmark overrides are unique per (tenant, metric). Two partial unique
-- indexes enforce that without colliding.
--
-- Targets are configuration an admin sets, so RLS is admin-scoped (same
-- posture as notification_channels) and changes are audited.
--
-- Idempotent throughout.

begin;

create table if not exists public.ehs_scorecard_targets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  kind        text not null check (kind in ('target', 'benchmark')),
  metric      text not null check (metric in (
                'trir', 'dart', 'recordables', 'capa_on_time_pct', 'rca_completion_pct'
              )),
  -- Goal year for kind='target'; null for kind='benchmark' (year-agnostic).
  period_year integer check (period_year is null or (period_year between 2000 and 2100)),
  value       numeric not null check (value >= 0),
  -- Optional source note for a benchmark override (e.g. "OSHA ITA peer set").
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  -- A target must name its year; a benchmark override must not.
  constraint ehs_scorecard_targets_period_year_shape check (
    (kind = 'target'    and period_year is not null) or
    (kind = 'benchmark' and period_year is null)
  )
);

create index if not exists idx_ehs_scorecard_targets_tenant
  on public.ehs_scorecard_targets(tenant_id, kind);

-- One target per (tenant, metric, year); one benchmark override per (tenant, metric).
create unique index if not exists uq_ehs_scorecard_targets_target
  on public.ehs_scorecard_targets(tenant_id, metric, period_year)
  where kind = 'target';
create unique index if not exists uq_ehs_scorecard_targets_benchmark
  on public.ehs_scorecard_targets(tenant_id, metric)
  where kind = 'benchmark';

drop trigger if exists trg_ehs_scorecard_targets_touch on public.ehs_scorecard_targets;
create trigger trg_ehs_scorecard_targets_touch
  before update on public.ehs_scorecard_targets
  for each row
  execute function public.touch_updated_at();

drop trigger if exists trg_audit_ehs_scorecard_targets on public.ehs_scorecard_targets;
create trigger trg_audit_ehs_scorecard_targets
  after insert or update or delete on public.ehs_scorecard_targets
  for each row execute function public.log_audit('id');

alter table public.ehs_scorecard_targets enable row level security;

-- Admin-scoped: targets/benchmarks are tenant configuration, and the
-- scorecard that reads them is itself admin-only.
drop policy if exists ehs_scorecard_targets_admin_scope on public.ehs_scorecard_targets;
create policy ehs_scorecard_targets_admin_scope on public.ehs_scorecard_targets
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
