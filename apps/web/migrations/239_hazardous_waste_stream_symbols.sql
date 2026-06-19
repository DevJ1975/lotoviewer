-- Migration 239: hazard-communication symbols on hazardous-waste streams.
--
-- Before this migration hazardous_waste_streams (140) carried only
-- free-form hazards text[] and RCRA waste_codes text[] — no structured
-- hazard-communication symbols. RCRA generators must mark accumulation
-- containers with the words "Hazardous Waste" and an indication of the
-- hazards (40 CFR 262.32(b)); in practice that means the same GHS
-- pictograms, NFPA 704 diamond, and DOT placard the facility already
-- manages for products. A pre-transport shipment additionally needs the
-- DOT proper shipping name + UN number + class + packing group on the
-- container and the uniform manifest (49 CFR 172 / 40 CFR 262).
--
-- These columns mirror chemical_products (089) BYTE-FOR-BYTE in name and
-- shape so a single renderer (lib/nfpa704.ts, lib/dotPlacards.ts,
-- lib/ghsPictograms.ts) serves both modules with no field-mapping shim.
-- The one addition is dot_proper_shipping_name, which products don't
-- carry but waste manifests require.
--
-- Symbols live at the STREAM level (the regulatory determination follows
-- the waste, not the drum), inherited by every container of that stream.
-- Additive, idempotent — inherits the table's existing tenant RLS.

begin;

alter table public.hazardous_waste_streams
  add column if not exists ghs_pictograms           text[] not null default '{}'::text[],
  add column if not exists ghs_signal_word          text,
  add column if not exists nfpa_health              smallint,
  add column if not exists nfpa_flammability        smallint,
  add column if not exists nfpa_instability         smallint,
  add column if not exists nfpa_special             text,
  add column if not exists dot_un_number            text,
  add column if not exists dot_hazard_class         text,
  add column if not exists dot_packing_group        text,
  add column if not exists dot_proper_shipping_name text;

-- Match the chemical_products check constraints. Guarded so the
-- migration is re-runnable (ADD CONSTRAINT has no IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hw_streams_ghs_signal_word_check'
  ) then
    alter table public.hazardous_waste_streams
      add constraint hw_streams_ghs_signal_word_check
      check (ghs_signal_word is null or ghs_signal_word in ('danger', 'warning'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hw_streams_nfpa_health_check'
  ) then
    alter table public.hazardous_waste_streams
      add constraint hw_streams_nfpa_health_check
      check (nfpa_health is null or nfpa_health between 0 and 4);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hw_streams_nfpa_flammability_check'
  ) then
    alter table public.hazardous_waste_streams
      add constraint hw_streams_nfpa_flammability_check
      check (nfpa_flammability is null or nfpa_flammability between 0 and 4);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hw_streams_nfpa_instability_check'
  ) then
    alter table public.hazardous_waste_streams
      add constraint hw_streams_nfpa_instability_check
      check (nfpa_instability is null or nfpa_instability between 0 and 4);
  end if;
end $$;

-- Filter waste streams by hazard pictogram (mirrors the chemical_products
-- GIN index in 089) for the facility hazard-symbol rollup report.
create index if not exists idx_hw_streams_ghs_pictograms
  on public.hazardous_waste_streams using gin (ghs_pictograms);

comment on column public.hazardous_waste_streams.ghs_pictograms is
  'GHS01..GHS09 codes for container marking (40 CFR 262.32). References ghs_pictogram_catalog.';
comment on column public.hazardous_waste_streams.dot_proper_shipping_name is
  'DOT proper shipping name for the uniform hazardous waste manifest (49 CFR 172.101).';

notify pgrst, 'reload schema';

commit;
