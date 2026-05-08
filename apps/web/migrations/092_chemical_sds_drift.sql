-- Migration 085: SDS drift-monitoring audit log.
--
-- Phase E of the chemical management module
-- (docs/chemical-management-system-plan.md). Logs every check the
-- nightly cron makes against a manufacturer SDS source URL: what we
-- saw, whether it differed from the stored revision, and (when it
-- did) which new chemical_sds_documents row was queued for review.
--
-- A row written every time the cron touches a product, including
-- "no change". The dashboard surfaces:
--   - last check per product (so missing rows = never checked)
--   - changed_at history (when revisions were detected)
--   - parser_review status of the queued new revision

begin;

create table if not exists public.chemical_sds_revision_checks (
  id            bigserial primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  product_id    uuid not null references public.chemical_products(id) on delete cascade,

  -- The active SDS at the time of the check, for traceability.
  baseline_sds_id uuid references public.chemical_sds_documents(id) on delete set null,
  baseline_revision_date date,
  baseline_file_hash     text,

  source_url    text not null,
  -- HTTP status from the fetch. NULL when the fetch was aborted before
  -- a response (DNS, TLS, allowlist, …).
  http_status   int,
  -- Latest revision date the AI extracted from the freshly fetched SDS.
  latest_revision_date date,
  -- sha256 of the fetched bytes. Same hash as baseline_file_hash means
  -- "byte-identical, no work to do" even if the URL technically changed.
  latest_file_hash     text,

  -- 'unchanged' | 'newer' | 'older' | 'unknown' | 'fetch_failed'
  -- 'older' is suspicious — manufacturer reverted? — and surfaces
  -- in the admin log even though the cron does NOT auto-import it.
  outcome       text not null check (outcome in
    ('unchanged', 'newer', 'older', 'unknown', 'fetch_failed')),

  -- When outcome = 'newer', the cron downloads + parses the new SDS
  -- and points this column at the resulting (pending-review) row.
  new_sds_id    uuid references public.chemical_sds_documents(id) on delete set null,

  -- Free-form note from the cron — useful when outcome = 'unknown'
  -- or 'fetch_failed' so the operator can debug without spelunking
  -- Sentry. ≤ 1 KB.
  notes         text,

  -- 'scheduled' | 'manual'. Manual triggers come from the per-product
  -- "Check for revision" button.
  trigger       text not null default 'scheduled' check (trigger in ('scheduled', 'manual')),

  checked_at    timestamptz not null default now(),
  triggered_by  uuid references auth.users(id)
);

create index if not exists idx_chem_drift_tenant_recent
  on public.chemical_sds_revision_checks(tenant_id, checked_at desc);
create index if not exists idx_chem_drift_product_recent
  on public.chemical_sds_revision_checks(product_id, checked_at desc);
create index if not exists idx_chem_drift_outcome
  on public.chemical_sds_revision_checks(tenant_id, outcome)
  where outcome in ('newer', 'older', 'fetch_failed');

alter table public.chemical_sds_revision_checks enable row level security;

drop policy if exists chem_drift_tenant on public.chemical_sds_revision_checks;
create policy chem_drift_tenant on public.chemical_sds_revision_checks
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (
      tenant_id in (select public.current_user_tenant_ids())
      or public.is_superadmin()
    )
  );

notify pgrst, 'reload schema';

commit;
