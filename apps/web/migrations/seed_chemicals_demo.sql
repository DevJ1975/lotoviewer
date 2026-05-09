-- Demo seed — populates the chemical-management module for a client
-- walkthrough. Creates a small but realistic mix on the demo tenant
-- so the catalog, inventory, expiring tile, and restricted-list page
-- render with usable data.
--
-- Coverage:
--   • 3 locations in a tree (Building A → Lab → Acid Cabinet)
--   • 4 products spanning the main hazard buckets:
--       acetone           (flammable liquid, GHS02)
--       sodium hydroxide  (corrosive, GHS05)
--       hydrogen peroxide (oxidizer, GHS03 + GHS05)
--       isopropyl alcohol (flammable liquid, GHS02 + GHS07)
--   • 5 inventory containers across the status spectrum:
--       in_stock × 2, in_use × 1, requested × 1, expiring-soon × 1
--   • 1 restricted-list rule: benzene CAS 71-43-2 banned
--
-- Idempotent — every insert is gated on a deterministic UUID, and the
-- restricted-list rule keys off (tenant_id, cas_number). Safe to re-run.
--
-- Not a numbered migration — manual run-once-per-tenant seed. Don't
-- run in production tenants.
--
-- Prereqs:
--   • Migrations through 102 applied
--   • At least one tenant flagged is_demo=true

do $$
declare
  v_tenant_id  uuid;
  v_owner_id   uuid;

  -- Locations
  v_loc_bldg   uuid := 'cccccccc-aaaa-0000-0000-000000000001';
  v_loc_lab    uuid := 'cccccccc-aaaa-0000-0000-000000000002';
  v_loc_acid   uuid := 'cccccccc-aaaa-0000-0000-000000000003';

  -- Products
  v_p_acetone  uuid := 'cccccccc-bbbb-0000-0000-000000000001';
  v_p_naoh     uuid := 'cccccccc-bbbb-0000-0000-000000000002';
  v_p_h2o2     uuid := 'cccccccc-bbbb-0000-0000-000000000003';
  v_p_ipa      uuid := 'cccccccc-bbbb-0000-0000-000000000004';

  -- Inventory containers
  v_inv_1      uuid := 'cccccccc-cccc-0000-0000-000000000001';
  v_inv_2      uuid := 'cccccccc-cccc-0000-0000-000000000002';
  v_inv_3      uuid := 'cccccccc-cccc-0000-0000-000000000003';
  v_inv_4      uuid := 'cccccccc-cccc-0000-0000-000000000004';
  v_inv_5      uuid := 'cccccccc-cccc-0000-0000-000000000005';
begin
  ----------------------------------------------------------------------
  -- Resolve the demo tenant + a creator user
  ----------------------------------------------------------------------
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    raise notice '[seed_chemicals_demo] No is_demo=true tenant — flag one first.';
    return;
  end if;

  select tm.user_id into v_owner_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id and tm.role = 'owner'
   order by tm.created_at asc
   limit 1;
  if v_owner_id is null then
    select tm.user_id into v_owner_id
      from public.tenant_memberships tm
     where tm.tenant_id = v_tenant_id
     order by tm.created_at asc
     limit 1;
  end if;

  ----------------------------------------------------------------------
  -- Locations (parent → child; the path trigger auto-fills the slash form)
  ----------------------------------------------------------------------
  insert into public.chemical_locations (id, tenant_id, parent_id, name, kind, created_by)
  values
    (v_loc_bldg, v_tenant_id, null,        'Building A',     'building', v_owner_id),
    (v_loc_lab,  v_tenant_id, v_loc_bldg,  'Lab',            'room',     v_owner_id),
    (v_loc_acid, v_tenant_id, v_loc_lab,   'Acid Cabinet',   'cabinet',  v_owner_id)
  on conflict (id) do nothing;

  ----------------------------------------------------------------------
  -- Products
  ----------------------------------------------------------------------
  insert into public.chemical_products (
    id, tenant_id, name, manufacturer, product_code, cas_numbers, physical_state,
    ghs_pictograms, ghs_signal_word,
    nfpa_health, nfpa_flammability, nfpa_instability,
    ppe_required, flash_point_c, boiling_point_c,
    pel_twa_ppm,
    storage_class, incompatibilities,
    sds_revision_date, sds_source_url,
    created_by
  )
  values
    (v_p_acetone, v_tenant_id, 'Acetone', 'Sigma-Aldrich', 'A-179',
     array['67-64-1'], 'liquid',
     array['GHS02','GHS07'], 'danger',
     1, 3, 0,
     array['Safety glasses','Nitrile gloves','Lab coat'],
     -20, 56, 250,
     'flammable_cabinet', array['oxidizers','strong_acids','strong_bases'],
     date '2024-08-15', 'https://example.com/sds/acetone.pdf',
     v_owner_id),

    (v_p_naoh, v_tenant_id, 'Sodium Hydroxide 50% solution', 'Fisher Scientific', 'SS279-1',
     array['1310-73-2'], 'liquid',
     array['GHS05'], 'danger',
     3, 0, 1,
     array['Chemical splash goggles','Neoprene gloves','Apron','Face shield'],
     null, 145, 2,
     'caustic', array['acids','aluminum','organic_halogens'],
     date '2025-01-10', 'https://example.com/sds/naoh.pdf',
     v_owner_id),

    (v_p_h2o2, v_tenant_id, 'Hydrogen Peroxide 30%', 'Sigma-Aldrich', 'H1009',
     array['7722-84-1'], 'liquid',
     array['GHS03','GHS05'], 'danger',
     2, 0, 1,
     array['Safety glasses','Nitrile gloves','Lab coat'],
     null, 108, 1,
     'oxidizer', array['flammables','organics','metals','reducing_agents'],
     date '2025-03-22', 'https://example.com/sds/h2o2.pdf',
     v_owner_id),

    (v_p_ipa, v_tenant_id, 'Isopropyl Alcohol', 'VWR', 'BDH1133',
     array['67-63-0'], 'liquid',
     array['GHS02','GHS07'], 'danger',
     1, 3, 0,
     array['Safety glasses','Nitrile gloves'],
     12, 82, 400,
     'flammable_cabinet', array['oxidizers','aldehydes'],
     date '2024-11-04', 'https://example.com/sds/ipa.pdf',
     v_owner_id)
  on conflict (id) do nothing;

  ----------------------------------------------------------------------
  -- Inventory containers — mix of statuses + an expiring-soon
  ----------------------------------------------------------------------
  insert into public.chemical_inventory_items (
    id, tenant_id, product_id, location_id,
    barcode, quantity, unit, container_type,
    received_date, expiration_date, lot_number,
    status, created_by
  )
  values
    (v_inv_1, v_tenant_id, v_p_acetone, v_loc_lab,
     'CHEM-DEMO-2026-0001', 4.0, 'L', 'bottle',
     current_date - 30, current_date + 200, 'AC-26-A14',
     'in_stock', v_owner_id),

    (v_inv_2, v_tenant_id, v_p_acetone, v_loc_lab,
     'CHEM-DEMO-2026-0002', 1.5, 'L', 'bottle',
     current_date - 90, current_date + 110, 'AC-26-A14',
     'in_use', v_owner_id),

    (v_inv_3, v_tenant_id, v_p_naoh, v_loc_acid,
     'CHEM-DEMO-2026-0003', 2.5, 'gal', 'jerrican',
     current_date - 14, current_date + 540, 'NA-25-Q3',
     'in_stock', v_owner_id),

    (v_inv_4, v_tenant_id, v_p_h2o2, v_loc_lab,
     'CHEM-DEMO-2026-0004', 500, 'mL', 'bottle',
     current_date - 60, current_date + 21, 'HP-25-088',
     'in_stock', v_owner_id),  -- expiring soon (< 30 days)

    (v_inv_5, v_tenant_id, v_p_ipa, null,
     'CHEM-DEMO-2026-0005', 4.0, 'L', 'bottle',
     null, null, null,
     'requested', v_owner_id)
  on conflict (id) do nothing;

  ----------------------------------------------------------------------
  -- One restricted-list rule so the page isn't empty
  ----------------------------------------------------------------------
  insert into public.chemical_restricted_list (
    tenant_id, severity, cas_number, name_pattern, reason, created_by
  )
  select v_tenant_id, 'banned', '71-43-2', null,
         'Benzene — IARC Group 1 carcinogen; banned per tenant policy',
         v_owner_id
   where not exists (
     select 1 from public.chemical_restricted_list
      where tenant_id = v_tenant_id and cas_number = '71-43-2'
   );

  raise notice '[seed_chemicals_demo] OK — locations: 3, products: 4, containers: 5, restricted: 1';
end $$;
