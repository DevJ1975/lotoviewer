-- Migration 241: NFPA + DOT columns on the EPCRA Tier II rollup view.
--
-- The Tier II report (EPCRA 40 CFR 370) is filed with the LEPC / SERC and
-- the local fire department, who use it for emergency PLANNING. The NFPA
-- 704 ratings and the DOT transport classification are exactly the
-- responder-facing facts those agencies want alongside the GHS hazards,
-- so surface them on v_chemical_tier_two and let tierTwoToCsv emit them.
--
-- CREATE OR REPLACE VIEW requires the existing column list to stay in the
-- same order; the seven new columns are APPENDED after earliest_expiration
-- (the documented "add columns only at the end" rule). The view keeps its
-- security_invoker = true so RLS on the base tables still applies.
--
-- Idempotent (CREATE OR REPLACE). No data migration.

begin;

create or replace view public.v_chemical_tier_two
  with (security_invoker = true)
  as
  select
    i.tenant_id,
    p.id              as product_id,
    p.name            as product_name,
    p.manufacturer,
    p.cas_numbers,
    p.storage_class,
    p.physical_state,
    p.ghs_signal_word,
    p.ghs_pictograms,
    l.id              as location_id,
    l.name            as location_name,
    l.path            as location_path,
    i.unit,
    sum(i.quantity)::numeric        as total_quantity,
    sum(i.quantity)::numeric        as max_daily_quantity,
    sum(i.quantity)::numeric        as average_daily_quantity,
    count(*)::int                   as container_count,
    min(i.expiration_date)          as earliest_expiration,
    -- Appended: responder-facing classification for emergency planning.
    p.nfpa_health,
    p.nfpa_flammability,
    p.nfpa_instability,
    p.nfpa_special,
    p.dot_un_number,
    p.dot_hazard_class,
    p.dot_packing_group
  from public.chemical_inventory_items i
  join public.chemical_products  p on p.id = i.product_id
  left join public.chemical_locations l on l.id = i.location_id
  where i.status in ('in_stock', 'in_use', 'quarantined')
    and (p.archived_at is null)
  group by i.tenant_id, p.id, p.name, p.manufacturer, p.cas_numbers,
           p.storage_class, p.physical_state, p.ghs_signal_word, p.ghs_pictograms,
           l.id, l.name, l.path, i.unit,
           p.nfpa_health, p.nfpa_flammability, p.nfpa_instability, p.nfpa_special,
           p.dot_un_number, p.dot_hazard_class, p.dot_packing_group;

notify pgrst, 'reload schema';

commit;
