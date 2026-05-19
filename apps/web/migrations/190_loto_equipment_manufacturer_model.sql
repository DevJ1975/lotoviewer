-- Migration 190: Manufacturer + model on loto_equipment.
--
-- Today the placard carries equipment_id (text PK) + a free-text
-- description. There is no canonical "what kind of machine is this"
-- field — which makes any downstream verification (does the photo
-- match the equipment? does the energy procedure look right for this
-- machine type?) impossible without a human walking the floor.
--
-- Two nullable text columns close the gap. We deliberately do NOT
-- backfill — there is no reliable source of the manufacturer /
-- model on existing rows. Admins fill these in as they go (the
-- existing PlacardDetailsSheet is extended in the same PR).
--
-- A simple btree composite index covers the most common future
-- query: "show me every Jensen conveyor across the tenant" /
-- "audit all SKAP-2400 mixers." Partial — null rows aren't
-- indexed since they're useless for the search.
--
-- Idempotent. Re-runs are no-ops.

begin;

alter table public.loto_equipment
  add column if not exists manufacturer text,
  add column if not exists model        text;

comment on column public.loto_equipment.manufacturer is
  'Equipment OEM (e.g. Jensen, SKA Pack, Heat and Control). Free-text. Used by admin search and by future "photo plausibility" tooling that needs to know what the machine should look like.';
comment on column public.loto_equipment.model is
  'Equipment model number (e.g. SKAP-2400, J-3000). Free-text. Paired with manufacturer.';

create index if not exists idx_loto_equipment_mfr_model
  on public.loto_equipment(tenant_id, manufacturer, model)
  where manufacturer is not null;

notify pgrst, 'reload schema';

commit;
