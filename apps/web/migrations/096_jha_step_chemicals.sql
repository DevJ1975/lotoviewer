-- Migration 089: link JHA steps to chemicals + derive PPE.
--
-- Closes the loop between Job Hazard Analysis and the chemical
-- catalog. When a JHA step involves a chemical (CIP caustic flush,
-- depalletizer adhesive cleaner, refrigeration ammonia leak check,
-- …), the author tags the step with the chemical_products row.
-- Downstream:
--
--   - The step's required PPE is the union of every linked
--     chemical's `ppe_required` (and any tenant-typed extras).
--     The editor flags PPE gaps (chemical SDS calls for
--     "chemical-resistant gloves" but the JHA doesn't list them).
--
--   - When a chemical's PPE updates (drift detected → review →
--     apply), every JHA referencing that chemical can be re-checked
--     by a follow-up sweep.
--
--   - Hazard category 'chemical' on a jha_hazards row gets a
--     derived link to the actual product, not just free text.
--
-- Idempotent.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. jha_step_chemicals — many-to-many
-- ──────────────────────────────────────────────────────────────────────────

create table if not exists public.jha_step_chemicals (
  id            uuid not null primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  step_id       uuid not null references public.jha_steps(id)        on delete cascade,
  product_id    uuid not null references public.chemical_products(id) on delete restrict,

  -- Optional notes captured by the JHA author — "used 5% solution"
  -- or "stored in cabinet 3, decanted into bottle". Doesn't gate
  -- the PPE derivation.
  usage_notes   text,

  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),

  unique (step_id, product_id)
);

create index if not exists idx_jha_step_chem_tenant
  on public.jha_step_chemicals(tenant_id);
create index if not exists idx_jha_step_chem_step
  on public.jha_step_chemicals(step_id);
create index if not exists idx_jha_step_chem_product
  on public.jha_step_chemicals(product_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. v_jha_step_required_ppe — derived PPE rollup per step
-- ──────────────────────────────────────────────────────────────────────────
--
-- Returns one row per (tenant, step) with the union of `ppe_required`
-- across every linked chemical (de-duped, lowercase-folded so
-- "Nitrile gloves" + "nitrile gloves" don't double-count). The PPE
-- gap analysis is done client-side via @soteria/core/chemicals
-- because it's tenant-PPE-vocabulary-specific.

create or replace view public.v_jha_step_required_ppe
  with (security_invoker = true)
  as
  select
    sc.tenant_id,
    sc.step_id,
    array_agg(distinct ppe order by ppe) filter (where ppe is not null and trim(ppe) <> '')
      as derived_ppe,
    array_agg(distinct sc.product_id order by sc.product_id) as product_ids
  from public.jha_step_chemicals sc
  join public.chemical_products p on p.id = sc.product_id
  cross join lateral unnest(coalesce(p.ppe_required, '{}'::text[])) as t(ppe)
  group by sc.tenant_id, sc.step_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. v_chemical_jha_usage — reverse lookup ("which JHAs use this chemical?")
-- ──────────────────────────────────────────────────────────────────────────
--
-- Used on the chemical detail page to answer "we want to ban this
-- chemical, what JHAs would I have to update?". Counts distinct
-- parent JHAs, not just steps, and excludes archived ones so a
-- ban-impact preview is realistic.

create or replace view public.v_chemical_jha_usage
  with (security_invoker = true)
  as
  select
    sc.tenant_id,
    sc.product_id,
    count(distinct s.jha_id)::int as jha_count,
    count(distinct sc.step_id)::int as step_count,
    array_agg(distinct s.jha_id) as jha_ids
  from public.jha_step_chemicals sc
  join public.jha_steps s on s.id = sc.step_id
  join public.jhas      j on j.id = s.jha_id
  where j.status <> 'superseded'
  group by sc.tenant_id, sc.product_id;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────────

alter table public.jha_step_chemicals enable row level security;

drop policy if exists jha_step_chem_tenant on public.jha_step_chemicals;
create policy jha_step_chem_tenant on public.jha_step_chemicals
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
