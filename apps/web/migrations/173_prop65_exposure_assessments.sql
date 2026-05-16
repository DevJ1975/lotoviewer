-- Migration 173: Prop 65 exposure assessments per (site, chemical).
--
-- The §25249.6 affirmative defense rests on documenting that the
-- exposure falls below the OEHHA safe-harbor level (NSRL/MADL). This
-- table holds that documentation: who assessed, by what method, with
-- what estimated daily intake, and the classification result.
--
-- The signed-off pair pattern (signed_name, signed_at) mirrors the
-- §147 sealed-PDF artifacts — once signed=true the record is the
-- record of decision and must not be silently mutated. UI gates this;
-- DB enforces only the data-shape invariant.
--
-- Idempotent.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prop65_exposure_route') then
    create type public.prop65_exposure_route as enum
      ('inhalation', 'dermal', 'ingestion', 'multiple');
  end if;
end $$;

create table if not exists public.prop65_exposure_assessments (
  id                          uuid        primary key default gen_random_uuid(),
  tenant_id                   uuid        not null references public.tenants(id) on delete cascade,
  site_id                     uuid        not null references public.prop65_sites(id) on delete cascade,
  chemical_inventory_id       uuid        not null references public.chemical_inventory_items(id) on delete cascade,
  assessed_at                 date        not null default current_date,
  exposure_route              public.prop65_exposure_route not null,
  -- Estimated daily intake the assessment relies on; compared to the
  -- linked Prop 65 entry's NSRL/MADL at decision time. Stored on the
  -- row so the historical reasoning is preserved even if OEHHA later
  -- republishes a new safe-harbor number.
  estimated_daily_intake_mg   numeric     check (estimated_daily_intake_mg is null or estimated_daily_intake_mg >= 0),
  below_safe_harbor           boolean,
  assessor_user_id            uuid        references auth.users(id) on delete set null,
  methodology_notes           text,
  signed                      boolean     not null default false,
  signed_name                 text,
  signed_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- A signed assessment must carry the signer's printed name AND a
  -- signed_at timestamp. We enforce the invariant at the DB so a
  -- hand-crafted UPDATE can't bypass it.
  check (
    case
      when signed then signed_name is not null and length(btrim(signed_name)) > 0 and signed_at is not null
      else true
    end
  )
);

create index if not exists idx_prop65_assessments_site
  on public.prop65_exposure_assessments (tenant_id, site_id, assessed_at desc);
create index if not exists idx_prop65_assessments_inv
  on public.prop65_exposure_assessments (tenant_id, chemical_inventory_id);

comment on table public.prop65_exposure_assessments is
  'Per-(site, chemical) Prop 65 exposure assessments. signed=true freezes the row as the §25249.6 affirmative defense record.';

drop trigger if exists trg_prop65_assessments_touch on public.prop65_exposure_assessments;
create trigger trg_prop65_assessments_touch
  before update on public.prop65_exposure_assessments
  for each row execute function public.touch_updated_at();

alter table public.prop65_exposure_assessments enable row level security;

drop policy if exists "prop65_assessments_tenant_scope" on public.prop65_exposure_assessments;
create policy "prop65_assessments_tenant_scope"
  on public.prop65_exposure_assessments
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

drop trigger if exists trg_audit_prop65_assessments on public.prop65_exposure_assessments;
create trigger trg_audit_prop65_assessments
  after insert or update or delete on public.prop65_exposure_assessments
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
