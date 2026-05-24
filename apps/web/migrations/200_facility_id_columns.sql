-- Migration 200: add facility_id to the domain tables (additive, nullable).
--
-- Phase 1 of facility-scoping the domain tables. Mirrors the multi-tenant
-- rollout shape (027 additive -> 028 backfill -> 029 lockdown): this migration
-- is additive and non-breaking. The NOT NULL lockdown + the runtime write-path
-- audit (service-role inserts, SECURITY DEFINER triggers) come LATER, only once
-- every write path stamps facility_id. Applying a NOT NULL lockdown before that
-- audit would make those inserts throw at runtime.
--
-- KEY DIVERGENCE FROM 027/052: those loops keyed off *every* table with a
-- tenant_id column. We must NOT do that here — it would wrongly add facility_id
-- to child/detail tables (which inherit their facility from a parent FK) and to
-- client-wide catalogs. Instead we drive two EXPLICIT, REVIEWABLE allow-lists:
--
--   BUCKET A — facility-scoped record tables. Operational records that
--     physically happen at one location. Get a DEFAULT of active_facility_id()
--     so PostgREST inserts auto-stamp the active facility (mirrors migration
--     052), and their existing rows are backfilled to the tenant's primary
--     facility. These become NOT NULL in the future lockdown migration.
--
--   BUCKET B — client-wide catalog/config tables. Authored once per client and
--     reused across facilities. facility_id is NULLABLE with NO default; NULL
--     means "shared across all of the tenant's facilities". Existing rows stay
--     NULL (shared). The RLS predicate in migration 201 surfaces NULL rows in
--     both roll-up and per-facility mode, which is exactly the shared behavior.
--
-- Tables NOT in either list are intentionally excluded: tenants /
-- tenant_memberships / audit_log / profiles / facilities, and all child/detail
-- tables that inherit facility via their parent FK (loto_energy_steps,
-- loto_atmospheric_tests, incident_people, action_item_comments, *_responses,
-- jha_steps/hazards/controls, safety_board_replies, etc.).
--
-- The loops skip any listed table that is missing or lacks tenant_id, printing
-- a NOTICE — review the Notices pane before applying 201.
--
-- Idempotent (add column if not exists; backfill only touches NULL rows).

begin;

-- ────────────────────────────────────────────────────────────────────
-- BUCKET A — facility-scoped record tables
-- ────────────────────────────────────────────────────────────────────
do $$
declare
  t       text;
  skipped text[] := '{}';
  bucket_a text[] := array[
    -- LOTO core + operations
    'loto_equipment', 'loto_devices', 'loto_gas_meters', 'loto_meter_alerts',
    'loto_hygiene_log', 'loto_reviews', 'loto_placard_reviews',
    'loto_periodic_inspections', 'loto_walkdown_checklists',
    'loto_confined_spaces', 'loto_confined_space_permits',
    'loto_hot_work_permits', 'loto_group_permits',
    'loto_training_records', 'loto_retraining_triggers',
    -- Equipment inspection module
    'equipment_inspections', 'equipment_defects', 'equipment_repairs',
    -- Generic inspections
    'inspections',
    -- Incidents / near-miss / observations
    'incidents', 'incident_capas', 'incident_severe_injury_reports',
    'near_misses',
    'bbs_observations', 'bbs_observations_v2', 'bbs_qr_locations',
    -- Hazardous waste
    'hazardous_waste_areas', 'hazardous_waste_containers',
    'hazardous_waste_streams', 'hazardous_waste_inspections',
    -- Chemicals (site inventory + storage tree + exposure events)
    'chemical_inventory_items', 'chemical_locations', 'chemical_exposure_events',
    -- Risk / JHA
    'risks', 'jhas',
    -- Working at heights
    'wah_permits', 'wah_anchors', 'wah_inspections',
    'wah_ladders_fixed', 'wah_ladders_portable',
    -- OSHA recordkeeping
    'osha_300_log_entries',
    -- Safety boards
    'safety_boards'
  ];
begin
  foreach t in array bucket_a loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'tenant_id'
    ) then
      skipped := array_append(skipped, t);
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists facility_id uuid references public.facilities(id)',
      t
    );
    -- Auto-stamp the active facility on PostgREST inserts (mirrors 052).
    execute format(
      'alter table public.%I alter column facility_id set default public.active_facility_id()',
      t
    );
    execute format(
      'create index if not exists %I on public.%I(facility_id)',
      'idx_' || t || '_facility', t
    );

    -- Backfill existing rows to their tenant's primary facility.
    execute format($q$
      update public.%I d
         set facility_id = f.id
        from public.facilities f
       where f.tenant_id = d.tenant_id
         and f.is_primary
         and d.facility_id is null
    $q$, t);

    raise notice 'facility_id (bucket A) added + backfilled on %', t;
  end loop;

  if array_length(skipped, 1) > 0 then
    raise notice 'Bucket A skipped (missing or no tenant_id): %', skipped;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────
-- BUCKET B — client-wide catalog/config (NULLABLE, NO default, NO backfill)
-- NULL facility_id = shared across all of the tenant's facilities.
-- ────────────────────────────────────────────────────────────────────
do $$
declare
  t       text;
  skipped text[] := '{}';
  bucket_b text[] := array[
    'chemical_products', 'chemical_sds_documents',
    'controls_library',
    'loto_competency_exams', 'loto_contractor_companies',
    'loto_webhook_subscriptions',
    'inspection_templates',
    'compliance_calendar_obligations',
    'ehs_scorecard_targets',
    'toolbox_talks',
    'notification_channels', 'incident_notification_rules',
    'saved_queries',
    'vendor_prequalifications'
  ];
begin
  foreach t in array bucket_b loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'tenant_id'
    ) then
      skipped := array_append(skipped, t);
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists facility_id uuid references public.facilities(id)',
      t
    );
    execute format(
      'create index if not exists %I on public.%I(facility_id)',
      'idx_' || t || '_facility', t
    );

    raise notice 'facility_id (bucket B, shared/nullable) added on %', t;
  end loop;

  if array_length(skipped, 1) > 0 then
    raise notice 'Bucket B skipped (missing or no tenant_id): %', skipped;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
