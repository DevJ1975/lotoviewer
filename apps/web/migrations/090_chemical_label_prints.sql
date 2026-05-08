-- Migration 083: Chemical labeling — print audit log.
--
-- Phase C of the chemical management module
-- (docs/chemical-management-system-plan.md). Captures every label
-- generated against a chemical product so an OSHA auditor asking
-- "show me when this drum got relabeled" has a single audit trail.
--
-- Labels themselves are PDFs streamed back to the caller; we don't
-- store the bytes (cheap to regenerate, expensive to store), only
-- the metadata + the snapshot of fields used at print time.

begin;

create table if not exists public.chemical_label_prints (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  product_id   uuid not null references public.chemical_products(id) on delete cascade,

  -- 'secondary_container' | 'placard' | 'inventory_tag'
  template     text not null check (template in
    ('secondary_container', 'placard', 'inventory_tag')),
  -- Free-form size key (e.g. '4x6', '8.5x11', '2x1'). Validated by
  -- the route handler against the template's catalog of sizes.
  size_key     text not null,

  -- Snapshot of the fields that went onto the label at print time.
  -- Lets us answer "what did the label that printed on 2026-04-01
  -- actually say?" even if the product row has since been edited.
  field_snapshot jsonb not null,

  -- Filename emitted by the API (no path — file is not stored).
  filename     text not null,
  byte_size    integer,

  printed_at   timestamptz not null default now(),
  printed_by   uuid references auth.users(id)
);

create index if not exists idx_chem_label_prints_tenant
  on public.chemical_label_prints(tenant_id, printed_at desc);
create index if not exists idx_chem_label_prints_product
  on public.chemical_label_prints(product_id, printed_at desc);

alter table public.chemical_label_prints enable row level security;

drop policy if exists chem_label_prints_tenant on public.chemical_label_prints;
create policy chem_label_prints_tenant on public.chemical_label_prints
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
