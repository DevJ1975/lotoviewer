-- Migration 240: hazardous-waste label / signage print audit log.
--
-- Mirrors chemical_label_prints (090) for the hazardous-waste module.
-- Every container label (40 CFR 262.32 marking) or accumulation-area
-- placard generated is recorded so an EPA / CUPA inspector asking
-- "when was this drum last relabeled?" has a single audit trail. As
-- with chemical labels we store only metadata + a snapshot of the
-- fields used at print time — the PDF itself is cheap to regenerate.
--
-- A print is bound to the waste STREAM (the source of the hazard data)
-- and OPTIONALLY to a specific container or accumulation area, since a
-- label can be printed for a stream before any container exists.
-- Additive, idempotent, tenant-scoped RLS (copied from 090).

begin;

create table if not exists public.hazardous_waste_label_prints (
  id           uuid not null primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  stream_id    uuid not null references public.hazardous_waste_streams(id) on delete cascade,
  -- Optional bindings: a container label or an area placard.
  container_id uuid references public.hazardous_waste_containers(id) on delete set null,
  area_id      uuid references public.hazardous_waste_areas(id) on delete set null,

  -- 'hw_container' | 'hw_accumulation_placard'
  template     text not null check (template in
    ('hw_container', 'hw_accumulation_placard')),
  -- Free-form size key (e.g. '4x6', '8.5x11'); validated by the route
  -- handler against the template's catalog of sizes.
  size_key     text not null,

  -- Snapshot of the fields that went onto the label at print time, so
  -- the record is faithful even after the stream row is later edited.
  field_snapshot jsonb not null,

  filename     text not null,
  byte_size    integer,

  printed_at   timestamptz not null default now(),
  printed_by   uuid references auth.users(id)
);

create index if not exists idx_hw_label_prints_tenant
  on public.hazardous_waste_label_prints(tenant_id, printed_at desc);
create index if not exists idx_hw_label_prints_stream
  on public.hazardous_waste_label_prints(stream_id, printed_at desc);

alter table public.hazardous_waste_label_prints enable row level security;

drop policy if exists hw_label_prints_tenant on public.hazardous_waste_label_prints;
create policy hw_label_prints_tenant on public.hazardous_waste_label_prints
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
