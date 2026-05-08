-- Migration 091: chemical MAQ rollup view (Phase G slice 6).
--
-- Joins chemical_max_allowable_quantities (set up in 086) against
-- live inventory containers to surface fire-code over-cap rooms.
-- The admin page reads this view; the catalog dashboard tile reads
-- a count from it.
--
-- A rule matches a container when:
--   - rule.product_id is set:    rule applies to that product anywhere,
--                                or scoped to rule.location_id when set.
--   - rule.storage_class is set: rule applies to every product whose
--                                products.storage_class matches by ILIKE,
--                                scoped to rule.location_id when set.
--
-- Quantities are summed in their stored unit AS-IS — unit conversion
-- is the rule author's responsibility (they pick the unit on the rule
-- and the rollup compares apples to apples). Containers in non-active
-- statuses (disposed/empty/rejected) drop out.
--
-- Idempotent.

begin;

create or replace view public.v_chemical_maq_status
  with (security_invoker = true)
  as
  with active as (
    select
      i.tenant_id,
      i.product_id,
      i.location_id,
      i.unit,
      coalesce(i.quantity, 0)::numeric as quantity,
      p.storage_class
    from public.chemical_inventory_items i
    join public.chemical_products       p on p.id = i.product_id
    where i.status in ('in_stock', 'in_use', 'quarantined')
      and (p.archived_at is null)
  )
  select
    r.id                                  as rule_id,
    r.tenant_id,
    r.location_id,
    r.product_id,
    r.storage_class,
    r.unit,
    r.max_quantity,
    r.reference,
    r.notes,
    coalesce(sum(a.quantity) filter (where a.unit = r.unit), 0)::numeric  as total_in_unit,
    r.max_quantity
      - coalesce(sum(a.quantity) filter (where a.unit = r.unit), 0)::numeric as headroom,
    case
      when coalesce(sum(a.quantity) filter (where a.unit = r.unit), 0)::numeric > r.max_quantity
        then true else false
    end                                   as exceeds_cap,
    count(*) filter (where a.unit is not null and a.unit <> r.unit)
      as containers_in_other_units
  from public.chemical_max_allowable_quantities r
  left join active a on a.tenant_id = r.tenant_id
    and (r.location_id is null or a.location_id = r.location_id)
    and (
      (r.product_id    is not null and a.product_id    = r.product_id)
      or
      (r.storage_class is not null and a.storage_class is not null
        and a.storage_class ilike '%' || r.storage_class || '%')
    )
  group by r.id, r.tenant_id, r.location_id, r.product_id, r.storage_class,
           r.unit, r.max_quantity, r.reference, r.notes;

notify pgrst, 'reload schema';

commit;
