-- Migration 176: Annual Prop 65 program review.
--
-- Cal. Health & Safety Code §25249.5 + the 2018 regulatory package
-- (Cal. Code Regs tit. 27 §25600 et seq.) read together require a
-- periodic top-to-bottom check that the program's warnings and
-- exposure assessments still reflect the actual operation. Enforcement
-- agencies and bounty hunters cite an annual review as the floor.
--
-- One row per (tenant, review_year). The signature pair locks the
-- record once committed — same posture as exposure assessments.
--
-- Idempotent.

begin;

create table if not exists public.prop65_annual_reviews (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  review_year              integer     not null check (review_year between 2000 and 2100),
  reviewer_user_id         uuid        references auth.users(id) on delete set null,
  reviewed_at              timestamptz not null default now(),
  signed                   boolean     not null default false,
  signed_name              text,
  signed_at                timestamptz,
  deviations               text,
  corrective_actions       text,
  next_due_at              timestamptz not null
                             default (now() + interval '365 days'),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (tenant_id, review_year),
  check (
    case
      when signed then signed_name is not null and length(btrim(signed_name)) > 0 and signed_at is not null
      else true
    end
  )
);

create index if not exists idx_prop65_annual_reviews_tenant
  on public.prop65_annual_reviews (tenant_id, review_year desc);

comment on table public.prop65_annual_reviews is
  '§25249.5 program review — one signed artifact per tenant per calendar year. next_due_at drives /admin/prop65 reminder banner.';

drop trigger if exists trg_prop65_annual_reviews_touch on public.prop65_annual_reviews;
create trigger trg_prop65_annual_reviews_touch
  before update on public.prop65_annual_reviews
  for each row execute function public.touch_updated_at();

alter table public.prop65_annual_reviews enable row level security;

drop policy if exists "prop65_annual_reviews_tenant_scope" on public.prop65_annual_reviews;
create policy "prop65_annual_reviews_tenant_scope"
  on public.prop65_annual_reviews
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

drop trigger if exists trg_audit_prop65_annual_reviews on public.prop65_annual_reviews;
create trigger trg_audit_prop65_annual_reviews
  after insert or update or delete on public.prop65_annual_reviews
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
