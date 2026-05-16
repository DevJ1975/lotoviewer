-- Migration 171: Link tenant inventory rows to Prop 65 list entries.
--
-- The OEHHA list (prop65_chemicals, migration 170) is system-wide.
-- A tenant's actual chemical inventory lives in chemical_inventory_items
-- (migration 091), which references chemical_products (089). The job
-- of this table is to assert: "for this tenant, this inventory item
-- is the substance OEHHA calls X". Most links are CAS-number matches
-- the admin confirms in /admin/prop65/chemicals; the 'auto' confidence
-- value indicates a CAS-based suggestion that hasn't been hand-verified.
--
-- A single inventory item may map to MULTIPLE Prop 65 entries — common
-- for mixtures (a paint stripper that's both methylene chloride and
-- toluene, for example). The unique constraint is therefore on the
-- triple (tenant, item, p65_entry).
--
-- Idempotent.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'prop65_link_confidence') then
    create type public.prop65_link_confidence as enum ('auto', 'confirmed');
  end if;
end $$;

create table if not exists public.prop65_chemical_links (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null references public.tenants(id) on delete cascade,
  chemical_inventory_id    uuid        not null references public.chemical_inventory_items(id) on delete cascade,
  prop65_chemical_id       uuid        not null references public.prop65_chemicals(id) on delete restrict,
  confidence               public.prop65_link_confidence not null default 'auto',
  linked_at                timestamptz not null default now(),
  linked_by_user_id        uuid        references auth.users(id) on delete set null,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (tenant_id, chemical_inventory_id, prop65_chemical_id)
);

create index if not exists idx_prop65_links_tenant_inventory
  on public.prop65_chemical_links (tenant_id, chemical_inventory_id);
create index if not exists idx_prop65_links_tenant_p65
  on public.prop65_chemical_links (tenant_id, prop65_chemical_id);

comment on table public.prop65_chemical_links is
  'Per-tenant mapping from chemical_inventory_items to OEHHA Prop 65 entries. confidence=auto = CAS-suggested; confidence=confirmed = admin-verified.';

drop trigger if exists trg_prop65_links_touch on public.prop65_chemical_links;
create trigger trg_prop65_links_touch
  before update on public.prop65_chemical_links
  for each row execute function public.touch_updated_at();

alter table public.prop65_chemical_links enable row level security;

drop policy if exists "prop65_chemical_links_tenant_scope" on public.prop65_chemical_links;
create policy "prop65_chemical_links_tenant_scope"
  on public.prop65_chemical_links
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

drop trigger if exists trg_audit_prop65_chemical_links on public.prop65_chemical_links;
create trigger trg_audit_prop65_chemical_links
  after insert or update or delete on public.prop65_chemical_links
  for each row execute function public.log_audit('id');

notify pgrst, 'reload schema';

commit;
