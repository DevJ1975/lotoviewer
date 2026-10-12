-- Rollback for migration 317: hazardous waste manifests.
--
-- DESTRUCTIVE: every manifest and its container list is dropped. Export them first
-- if any were filled in; the audit log keeps the manifests' rows, not the container
-- lists.
--
-- Containers are the one thing outside this migration's tables it touches. A container
-- that a draft, shipped or exception-reported manifest left "in shipment" is set back
-- to 'closed' before the lists that explain why are dropped; without that it would be
-- stuck "in shipment" with no manifest to finish it. The data effect to know about:
-- for a shipped or exception-reported manifest the waste has physically left, so those
-- containers read 'closed' (still on site) until someone marks them disposed. Containers
-- a completed manifest disposed stay disposed, and a cancelled manifest's were already
-- put back.
--
-- Nothing else is touched: the older hazardous_waste_* tables, their policies and
-- triggers belong to 140, 142 and 272.
--
-- Idempotent.

begin;

do $$
begin
  if to_regclass('public.hazardous_waste_shipment_containers') is not null then
    update public.hazardous_waste_containers
       set status = 'closed'
     where status = 'in_shipment'
       and id in (select container_id from public.hazardous_waste_shipment_containers where released_at is null);
  end if;
end $$;

drop table if exists public.hazardous_waste_shipment_containers;
drop table if exists public.hazardous_waste_shipments;

drop function if exists public.hw_transition_shipment(uuid, text, date, text);
drop function if exists public.hw_create_shipment(uuid[], jsonb);
drop function if exists public.hw_manifest_refuse(text, text);
drop function if exists public.hw_shipment_container_guard();
drop function if exists public.hw_shipments_release_containers();
drop function if exists public.hw_shipments_guard();

notify pgrst, 'reload schema';

commit;
