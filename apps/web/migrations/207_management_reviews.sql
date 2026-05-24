-- Migration 207: management review register (ISO 14001:2015 §9.3).
--
-- Top management reviews the EMS at planned intervals. §9.3.2 prescribes
-- the inputs (status of prior-review actions; changes in issues,
-- obligations, and significant aspects; extent objectives were met;
-- nonconformities & corrective actions; monitoring, audit, and compliance
-- results; adequacy of resources; communications; improvement
-- opportunities) and §9.3.3 the outputs (conclusions on continuing
-- suitability/adequacy/effectiveness; decisions on improvement, change,
-- and resources).
--
-- A review is one row. Its inputs are captured as a summary and its
-- outputs as conclusions + decisions. Action items arising from a review
-- are NOT a new table — they are nonconformities (migration 206) with
-- source_type = 'management_review', so they flow through the same §10.2
-- CAPA + verification loop as every other finding.
--
-- Idempotent.

begin;

create table if not exists public.management_reviews (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,

  title           text        not null check (length(btrim(title)) > 0),
  review_date     date        not null default current_date,
  period_start    date,
  period_end      date,
  attendees       text,

  -- §9.3.2 inputs (free-text summary; the UI renders the standard agenda).
  inputs_summary  text,
  -- §9.3.3 outputs.
  conclusions     text,
  decisions       text,

  status          text        not null default 'scheduled' check (status in (
    'scheduled','in_progress','completed','cancelled')),
  chaired_by      uuid        references auth.users(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid        references auth.users(id) on delete set null,
  updated_by      uuid        references auth.users(id) on delete set null,

  check (period_end is null or period_start is null or period_end >= period_start)
);

create index if not exists idx_management_reviews_tenant_date
  on public.management_reviews(tenant_id, review_date desc);
create index if not exists idx_management_reviews_status
  on public.management_reviews(tenant_id, status);

comment on table public.management_reviews is
  'ISO 14001:2015 §9.3 management review records. Action items are nonconformities with source_type = management_review.';

alter table public.management_reviews enable row level security;

drop policy if exists "management_reviews_tenant_scope" on public.management_reviews;
create policy "management_reviews_tenant_scope"
  on public.management_reviews
  for all to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    or public.is_superadmin()
  );

drop trigger if exists trg_management_reviews_touch on public.management_reviews;
create trigger trg_management_reviews_touch
  before update on public.management_reviews
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_management_reviews on public.management_reviews;
create trigger trg_audit_management_reviews
  after insert or update or delete on public.management_reviews
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
