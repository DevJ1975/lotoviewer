-- Migration 202: WLS Demo seed functions for the Incident, Near-Miss,
-- and BBS modules — so "Reset Demo" restores them.
--
-- WHY THIS EXISTS
-- ───────────────
-- Reset Demo (POST /api/superadmin/tenants/0002/reset-demo) wipes every
-- tenant-scoped row and re-seeds canonical demo data by RPC-ing into
-- seed_wls_demo() (migration 030, LOTO/confined-space/hot-work) and
-- seed_wls_worker_readiness_demo() (migration 119). The Incident,
-- Near-Miss, and BBS modules shipped AFTER those functions, so their
-- demo data lived only in the standalone, run-once seed_*.sql files —
-- meaning a reset WIPED the BBS observations without restoring them and
-- never restored the incident scorecard. This migration closes that gap.
--
-- It promotes the standalone seeds to first-class, idempotent functions
-- (the single source of truth) so the reset route can call them just
-- like the worker-readiness add-on. The seed_incidents_demo.sql /
-- seed_bbs_demo.sql files become thin wrappers that call these.
--
-- SCORECARD RECONCILIATION (incidents)
-- ────────────────────────────────────
-- The EHS scorecard computes its current-year KPIs live from incidents +
-- incident_classifications + incident_care_cases + incident_investigations
-- (see packages/core/src/incidentScorecardMetrics.ts, default 365-day
-- window). This seed lands 13 incidents, of which exactly THREE are
-- OSHA-recordable (meets_recording_criteria=true), and 10 carry an
-- incident_investigation (one per investigation, 1:1):
--
--   recordables (3): DEMO1 days_away, DEMO6 other_recordable, DEMO8 restricted
--     → TRIR  = 3 × 200,000 / 96,720 ≈ 6.2
--     → DART  = (1 days_away + 1 restricted) × 200,000 / 96,720 ≈ 4.1
--     → severity rate = 5 days away × 200,000 / 96,720 ≈ 10.3
--   investigations (10): DEMO1(5whys,open), DEMO6(fishbone,done),
--     DEMO2(icam,done), DEMO4(taproot,done), DEMO8(5whys,done),
--     DEMO9(fishbone,done), DEMO10(taproot,done), DEMO11(icam,done),
--     DEMO12(5whys,done), DEMO13(fishbone,open)
--     → RCA completion = recordables with a completed RCA / recordables
--       = 2/3 ≈ 67% (DEMO1 deliberately left mid-investigation)
--   near-miss incidents (6): DEMO2, DEMO5, DEMO7, DEMO9, DEMO10, DEMO13
--     → near-miss : recordable ratio = 6 / 3 = 2.0
--
-- The osha_annual_summaries row for the current year is upserted to the
-- same 3-recordable picture so the 300A page and the YoY chart agree
-- with the live KPI panel.
--
-- All four RCA methods (5-whys, fishbone, taproot, ICAM) are exercised so
-- the investigation UI demos the full surface.
--
-- IDEMPOTENT — deterministic ids + ON CONFLICT / NOT EXISTS guards. Safe
-- to re-run. Resolves the demo tenant by tenants.is_demo = true.

begin;

-- ════════════════════════════════════════════════════════════════════════
-- 1. seed_wls_incidents_demo() — incidents, classifications, care, the 10
--    investigations (all four RCA methods), CAPAs, OSHA 300/300A.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.seed_wls_incidents_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id            uuid;
  v_owner_id             uuid;
  v_admin_id             uuid;
  v_member_id            uuid;
  v_establishment_id     uuid;

  -- Existing incidents (stable ids — keep in sync with prior demo).
  v_inc_injury_id        uuid := '11111111-aaaa-bbbb-cccc-000000000001';
  v_inc_near_miss_id     uuid := '11111111-aaaa-bbbb-cccc-000000000002';
  v_inc_property_id      uuid := '11111111-aaaa-bbbb-cccc-000000000003';
  v_inc_environmental_id uuid := '11111111-aaaa-bbbb-cccc-000000000004';
  v_inc_anon_id          uuid := '11111111-aaaa-bbbb-cccc-000000000005';
  v_inc_closed_id        uuid := '11111111-aaaa-bbbb-cccc-000000000006';
  v_inc_repeat_id        uuid := '11111111-aaaa-bbbb-cccc-000000000007';
  -- New investigated incidents (DEMO8-DEMO13).
  v_inc_back_id          uuid := '11111111-aaaa-bbbb-cccc-000000000008';
  v_inc_totes_id         uuid := '11111111-aaaa-bbbb-cccc-000000000009';
  v_inc_arc_id           uuid := '11111111-aaaa-bbbb-cccc-000000000010';
  v_inc_crane_id         uuid := '11111111-aaaa-bbbb-cccc-000000000011';
  v_inc_oil_id           uuid := '11111111-aaaa-bbbb-cccc-000000000012';
  v_inc_ped_id           uuid := '11111111-aaaa-bbbb-cccc-000000000013';

  v_qr_token_id          uuid := '11111111-aaaa-bbbb-dddd-000000000001';
  v_qr_token_hex         text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  -- Investigations (1:1 with incident). eeee-1/eeee-2 are the originals.
  v_inv_id               uuid := '11111111-aaaa-bbbb-eeee-000000000001'; -- DEMO1
  v_inv_closed_id        uuid := '11111111-aaaa-bbbb-eeee-000000000002'; -- DEMO6
  v_inv_nm_id            uuid := '11111111-aaaa-bbbb-eeee-000000000022'; -- DEMO2 icam
  v_inv_env_id           uuid := '11111111-aaaa-bbbb-eeee-000000000044'; -- DEMO4 taproot
  v_inv_back_id          uuid := '11111111-aaaa-bbbb-eeee-000000000088'; -- DEMO8 5whys
  v_inv_totes_id         uuid := '11111111-aaaa-bbbb-eeee-000000000099'; -- DEMO9 fishbone
  v_inv_arc_id           uuid := '11111111-aaaa-bbbb-eeee-000000000110'; -- DEMO10 taproot
  v_inv_crane_id         uuid := '11111111-aaaa-bbbb-eeee-000000000111'; -- DEMO11 icam
  v_inv_oil_id           uuid := '11111111-aaaa-bbbb-eeee-000000000122'; -- DEMO12 5whys
  v_inv_ped_id           uuid := '11111111-aaaa-bbbb-eeee-000000000133'; -- DEMO13 fishbone

  v_care_id              uuid := '11111111-aaaa-bbbb-ffff-000000000001'; -- DEMO1
  v_care_back_id         uuid := '11111111-aaaa-bbbb-ffff-000000000008'; -- DEMO8
  v_person_injured_id    uuid := '11111111-aaaa-cccc-ffff-000000000001'; -- DEMO1
  v_person_back_id       uuid := '11111111-aaaa-cccc-ffff-000000000008'; -- DEMO8

  v_action_done_id       uuid := '11111111-bbbb-cccc-ffff-000000000001';
  v_action_open_id       uuid := '11111111-bbbb-cccc-ffff-000000000002';
  v_action_ppe_id        uuid := '11111111-bbbb-cccc-ffff-000000000003';
  v_action_back1_id      uuid := '11111111-bbbb-cccc-ffff-000000000008';
  v_action_back2_id      uuid := '11111111-bbbb-cccc-ffff-000000000009';
  v_action_totes_id      uuid := '11111111-bbbb-cccc-ffff-000000000010';
  v_action_arc_id        uuid := '11111111-bbbb-cccc-ffff-000000000011';
  v_action_crane_id      uuid := '11111111-bbbb-cccc-ffff-000000000012';

  v_summary              jsonb;
  v_year                 int := extract(year from now())::int;
begin
  -- ── Resolve the demo tenant ──────────────────────────────────────────
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    return '[seed_wls_incidents_demo] skipped — no is_demo=true tenant';
  end if;

  -- ── Resolve a few users on this tenant ───────────────────────────────
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
  if v_owner_id is null then
    return '[seed_wls_incidents_demo] skipped — no tenant_memberships on demo tenant';
  end if;

  select tm.user_id into v_admin_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id and tm.role in ('admin','owner') and tm.user_id <> v_owner_id
   order by tm.created_at asc
   limit 1;
  if v_admin_id is null then v_admin_id := v_owner_id; end if;

  select tm.user_id into v_member_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id and tm.user_id not in (v_owner_id, v_admin_id)
   order by tm.created_at asc
   limit 1;
  if v_member_id is null then v_member_id := v_admin_id; end if;

  -- ── Establishment for OSHA forms ─────────────────────────────────────
  select id into v_establishment_id
    from public.osha_establishments
   where tenant_id = v_tenant_id
   order by created_at asc
   limit 1;
  if v_establishment_id is null then
    insert into public.osha_establishments (
      tenant_id, establishment_name, street, city, state, zip, naics_code,
      hours_employees_by_year,
      certifying_executive_name, certifying_executive_title,
      created_by, updated_by
    ) values (
      v_tenant_id, 'Demo Plant — Springfield', '1 Industrial Way',
      'Springfield', 'IL', '62701', '311615',
      jsonb_build_object(v_year::text, jsonb_build_object('employees', 47, 'hours', 96720)),
      'Pat Owens', 'VP Operations',
      v_owner_id, v_owner_id
    ) returning id into v_establishment_id;
  end if;

  perform public.seed_incident_notification_defaults(v_tenant_id);

  -- ── Anonymous-intake QR token ────────────────────────────────────────
  insert into public.incident_anon_intake_tokens
    (id, tenant_id, label, token, rate_limit_per_hour, total_reports, created_by, updated_by)
    values
    (v_qr_token_id, v_tenant_id, 'Loading Dock B (demo)', v_qr_token_hex, 30, 1,
     v_owner_id, v_owner_id)
    on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- Incidents 1-7 (original demo set)
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, assigned_investigator,
    created_at, updated_at, updated_by
  ) values (
    v_inc_injury_id, v_tenant_id, 'INC-2026-DEMO1', 'injury_illness',
    now() - interval '14 days', now() - interval '14 days', v_member_id, false,
    'Production Line 3', 'Worker slipped on hydraulic oil leak from forklift while loading pallets. Fell onto knee, immediate swelling and pain.',
    'Equipment de-energized via LOTO. EMS called. Worker transported to clinic. Floor cordoned and cleaned.',
    'lost_time', 'high', 'possible',
    'pending_review', v_admin_id,
    now() - interval '14 days', now() - interval '5 days', v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, created_at, updated_at, updated_by
  ) values (
    v_inc_near_miss_id, v_tenant_id, 'INC-2026-DEMO2', 'near_miss',
    now() - interval '7 days', now() - interval '7 days', v_member_id, false,
    'Warehouse — Aisle 4', 'Pallet shifted when forklift stopped abruptly. Operator caught it before it tipped. No injury.',
    'Operator retrained on smooth-stop technique. Supervisor briefed shift.',
    'none', 'high', 'likely',
    'closed', now() - interval '7 days', now() - interval '6 days', v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, created_at, updated_at, updated_by
  ) values (
    v_inc_property_id, v_tenant_id, 'INC-2026-DEMO3', 'property_damage',
    now() - interval '21 days', now() - interval '21 days', v_owner_id, false,
    'Warehouse — Aisle 7 racking', 'Forklift impacted upright support of pallet rack. Bay flagged out of service pending engineering review.',
    'Bay marked DO NOT LOAD. Photos taken. Vendor scheduled for inspection.',
    'none', 'moderate', 'unlikely',
    'closed', now() - interval '21 days', now() - interval '15 days', v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, spill_substance, spill_quantity, spill_quantity_unit,
    created_at, updated_at, updated_by
  ) values (
    v_inc_environmental_id, v_tenant_id, 'INC-2026-DEMO4', 'environmental',
    now() - interval '3 days', now() - interval '3 days', v_admin_id, false,
    'Wastewater treatment — chlorination room',
    'Damaged hose released chlorine solution onto secondary containment pad. ~25 lb released; contained on pad with no off-site discharge.',
    'Area evacuated. Hose isolated. Containment confirmed. Spill team responded with full PPE.',
    'first_aid', 'extreme', 'rare',
    'investigating', 'Chlorine', 25, 'lb',
    now() - interval '3 days', now() - interval '2 days', v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous, anon_token_id,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential,
    status, created_at, updated_at
  ) values (
    v_inc_anon_id, v_tenant_id, 'INC-2026-DEMO5', 'near_miss',
    now() - interval '2 days', now() - interval '2 days', null, true, v_qr_token_id,
    'Loading Dock B (demo)',
    'Saw a co-worker climbing on top of a pallet to reach an overhead light fixture instead of using a ladder. They got down before anyone fell.',
    null,
    'none', 'high',
    'reported', now() - interval '2 days', now() - interval '2 days'
  ) on conflict (id) do nothing;

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential,
    status, closed_at, closed_by,
    created_at, updated_at, updated_by
  ) values (
    v_inc_closed_id, v_tenant_id, 'INC-2025-DEMO6', 'injury_illness',
    now() - interval '90 days', now() - interval '90 days', v_member_id, false,
    'Maintenance shop — grinder station',
    'Worker received metal sliver to right eye while grinding without face shield. First-aid eye wash + clinic visit, no time lost.',
    'Worker escorted to clinic. Grinder station tagged for face-shield-required signage.',
    'medical', 'moderate',
    'closed', now() - interval '60 days', v_admin_id,
    now() - interval '90 days', now() - interval '60 days', v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description,
    severity_actual, severity_potential,
    status, created_at, updated_at, updated_by
  ) values (
    v_inc_repeat_id, v_tenant_id, 'INC-2026-DEMO7', 'near_miss',
    now() - interval '1 day', now() - interval '1 day', v_member_id, false,
    'Production Line 3', 'Hydraulic oil leak under forklift again — caught before anyone slipped. Same forklift as INC-2026-DEMO1.',
    'none', 'high',
    'reported', now() - interval '1 day', now() - interval '1 day', v_admin_id
  ) on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- New investigated incidents (DEMO8-DEMO13)
  -- ────────────────────────────────────────────────────────────────────

  -- 8. RECORDABLE restricted-duty back strain (~45 days ago, closed).
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, assigned_investigator, closed_at, closed_by,
    created_at, updated_at, updated_by
  ) values (
    v_inc_back_id, v_tenant_id, 'INC-2026-DEMO8', 'injury_illness',
    now() - interval '45 days', now() - interval '45 days', v_member_id, false,
    'Maintenance shop — conveyor bay',
    'Maintenance tech strained lower back lifting a 60 lb gearbox by hand during a conveyor repair instead of using the overhead hoist.',
    'Work stopped. Tech evaluated at clinic; placed on restricted duty. Hoist inspected and returned to service.',
    'medical', 'moderate', 'possible',
    'closed', v_admin_id, now() - interval '20 days', v_admin_id,
    now() - interval '45 days', now() - interval '20 days', v_admin_id
  ) on conflict (id) do nothing;

  -- 9. NEAR-MISS — toppled totes (~30 days ago, closed).
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, created_at, updated_at, updated_by
  ) values (
    v_inc_totes_id, v_tenant_id, 'INC-2026-DEMO9', 'near_miss',
    now() - interval '30 days', now() - interval '30 days', v_member_id, false,
    'Packaging — pack-out station',
    'Stacked totes toppled off an overloaded cart next to the pack line. No one was struck.',
    'Area cleared. Cart load limit posted. Crew reminded of stacking limit.',
    'none', 'high', 'possible',
    'closed', now() - interval '30 days', now() - interval '24 days', v_admin_id
  ) on conflict (id) do nothing;

  -- 10. NEAR-MISS — live-panel arc-flash hazard (~60 days ago, closed).
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, created_at, updated_at, updated_by
  ) values (
    v_inc_arc_id, v_tenant_id, 'INC-2026-DEMO10', 'near_miss',
    now() - interval '60 days', now() - interval '60 days', v_admin_id, false,
    'Electrical room — MCC-B',
    'Technician opened a live 480V panel to troubleshoot without verifying de-energization. Arc-flash exposure risk; no contact made.',
    'Panel re-secured. Full LOTO + voltage verification required before re-entry. Arc-flash PPE audit triggered.',
    'none', 'extreme', 'unlikely',
    'closed', now() - interval '60 days', now() - interval '52 days', v_admin_id
  ) on conflict (id) do nothing;

  -- 11. PROPERTY damage — dropped die from overhead crane (~75 days ago).
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, closed_at, closed_by,
    created_at, updated_at, updated_by
  ) values (
    v_inc_crane_id, v_tenant_id, 'INC-2026-DEMO11', 'property_damage',
    now() - interval '75 days', now() - interval '75 days', v_owner_id, false,
    'Tool & die — crane bay',
    'Overhead crane dropped a ~200 lb die onto the floor when the sling slipped. Floor gouged; no personnel in the lift zone.',
    'Crane tagged out. Rigging quarantined for inspection. Lift zone barricaded.',
    'none', 'high', 'unlikely',
    'closed', now() - interval '55 days', v_admin_id,
    now() - interval '75 days', now() - interval '55 days', v_admin_id
  ) on conflict (id) do nothing;

  -- 12. ENVIRONMENTAL — minor hydraulic oil sheen, sub-RQ (~120 days ago).
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, spill_substance, spill_quantity, spill_quantity_unit,
    closed_at, closed_by,
    created_at, updated_at, updated_by
  ) values (
    v_inc_oil_id, v_tenant_id, 'INC-2026-DEMO12', 'environmental',
    now() - interval '120 days', now() - interval '120 days', v_member_id, false,
    'Yard — north dock',
    'About 2 gallons of hydraulic oil sheen reached the storm-drain grate before absorbent booms were placed.',
    'Booms deployed; drain inlet protected; absorbent applied. No off-site discharge confirmed.',
    'none', 'moderate', 'possible',
    'closed', 'Hydraulic oil', 2, 'gal',
    now() - interval '100 days', v_admin_id,
    now() - interval '120 days', now() - interval '100 days', v_admin_id
  ) on conflict (id) do nothing;

  -- 13. NEAR-MISS — pedestrian / forklift blind corner (~10 days ago, open).
  insert into public.incidents (
    id, tenant_id, report_number, incident_type,
    occurred_at, reported_at, reported_by, is_anonymous,
    location_text, description, immediate_action_taken,
    severity_actual, severity_potential, probability,
    status, assigned_investigator,
    created_at, updated_at, updated_by
  ) values (
    v_inc_ped_id, v_tenant_id, 'INC-2026-DEMO13', 'near_miss',
    now() - interval '10 days', now() - interval '10 days', v_member_id, false,
    'Warehouse — Aisle 1 blind corner',
    'Forklift and a pedestrian nearly collided at a blind corner. Driver stopped within a foot; no contact.',
    'Spotter posted at the corner. Convex mirror + pedestrian walkway striping requested.',
    'none', 'high', 'possible',
    'investigating', v_admin_id,
    now() - interval '10 days', now() - interval '8 days', v_admin_id
  ) on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO1 — injured person + classification + care + 300 log
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_people (
    id, tenant_id, incident_id,
    person_role, full_name, email,
    employment_type, job_title, hire_date,
    body_part, injury_nature, injury_source,
    is_primary
  ) values (
    v_person_injured_id, v_tenant_id, v_inc_injury_id,
    'injured', 'Riley Demo', 'riley.demo@example.com',
    'employee', 'Forklift operator', current_date - interval '4 years',
    array['knee_right'], 'sprain', 'wet floor / hydraulic fluid',
    true
  ) on conflict (id) do nothing;

  insert into public.incident_classifications (
    tenant_id, incident_id,
    is_work_related, is_new_case, meets_recording_criteria,
    classification, is_privacy_case,
    decision_path,
    classified_by, classified_at, human_overrode_ai
  ) values (
    v_tenant_id, v_inc_injury_id,
    true, true, true,
    'days_away', false,
    jsonb_build_array(
      jsonb_build_object('question','Was the case work-related? (1904.5)','answer','yes'),
      jsonb_build_object('question','Is this a new case (not a continuation of an existing recorded case)? (1904.6)','answer','yes'),
      jsonb_build_object('question','Did the case result in death?','answer','no'),
      jsonb_build_object('question','Did the case result in days away from work?','answer','yes','reason','5 day(s)')
    ),
    v_admin_id, now() - interval '13 days', false
  ) on conflict (incident_id) do nothing;

  insert into public.incident_care_cases (
    id, tenant_id, incident_id, person_id,
    case_status, initial_visit_at, treating_physician, clinic_name, diagnosis,
    days_away_from_work, days_restricted, days_lost,
    return_to_work_at, modified_duty_start, modified_duty_end,
    restrictions, next_followup_at,
    drug_test_status, drug_test_at,
    case_manager_user_id, created_by, updated_by
  ) values (
    v_care_id, v_tenant_id, v_inc_injury_id, v_person_injured_id,
    'modified_duty', now() - interval '14 days',
    'Dr. Lena Park', 'Springfield Occ-Med Clinic',
    'Right knee sprain, grade 2; ligament intact. Conservative treatment + PT.',
    5, 7, 5,
    null, now() - interval '7 days', now() + interval '7 days',
    array['No lifting > 20 lb', 'No climbing ladders', 'Sit-down work only'],
    now() + interval '2 days',
    'negative', now() - interval '14 days',
    v_admin_id, v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.osha_300_log_entries (
    tenant_id, establishment_id, incident_id, year,
    case_number, employee_name, job_title, date_of_injury,
    location_text, injury_description,
    classification, days_away, days_restricted, injury_type, is_privacy_case
  ) values (
    v_tenant_id, v_establishment_id, v_inc_injury_id, extract(year from now() - interval '14 days')::int,
    'INC-2026-DEMO1', 'Riley Demo', 'Forklift operator', (now() - interval '14 days')::date,
    'Production Line 3', 'Worker slipped on hydraulic oil leak from forklift; right knee sprain.',
    'days_away', 5, 0, 'injury', false
  ) on conflict (incident_id, year) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO1 — investigation (5 Whys, OPEN) + CAPAs
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at,
    lead_investigator, team_member_ids,
    scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    created_by, updated_by
  ) values (
    v_inv_id, v_tenant_id, v_inc_injury_id, '5_whys',
    now() - interval '13 days', now() - interval '6 days',
    v_admin_id, array[v_admin_id, v_member_id],
    'Why did Riley slip on Production Line 3? In scope: forklift maintenance + housekeeping protocols. Out of scope: facility-wide flooring spec.',
    e'14 days ago at 09:42 a forklift parked at PL3 leaked hydraulic oil onto the walkway.\nAt 10:15, Riley walked through the area to load pallets and slipped, landing on the right knee.\nEMS notified at 10:17; clinic visit at 11:30; lost-time confirmed.',
    'Slip on hydraulic fluid on walkway.',
    'Forklift hydraulic hose was past its scheduled replacement date. Leak detection on a 30-day rounds cycle missed the seep.',
    'Preventive-maintenance schedule for hydraulic hoses was not enforced; no daily pre-shift fluid check.',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_5whys (tenant_id, investigation_id, ordinal, question, answer, is_root) values
    (v_tenant_id, v_inv_id, 1, 'What happened?',                    'Riley slipped on hydraulic fluid and sprained their knee.', false),
    (v_tenant_id, v_inv_id, 2, 'Why was there hydraulic fluid?',    'Forklift hose was leaking.',                                false),
    (v_tenant_id, v_inv_id, 3, 'Why was the hose leaking?',         'It was past its scheduled replacement date.',               false),
    (v_tenant_id, v_inv_id, 4, 'Why was the replacement missed?',   'PM schedule was tracked manually and the date drifted.',    false),
    (v_tenant_id, v_inv_id, 5, 'Why was the PM schedule manual?',   'No automated PM trigger on hydraulic-system components.',   true)
  on conflict (investigation_id, ordinal) do nothing;

  insert into public.incident_actions (
    id, tenant_id, incident_id,
    action_type, hierarchy_of_controls, description,
    owner_user_id, due_at, status,
    completed_at, verified_at, verified_by, verification_evidence,
    created_by, updated_by
  ) values
    (v_action_done_id, v_tenant_id, v_inc_injury_id,
     'corrective', 'engineering', 'Replace failing hydraulic hose on forklift FK-204 + inspect adjacent units.',
     v_admin_id, now() - interval '10 days', 'verified',
     now() - interval '11 days', now() - interval '10 days', v_owner_id, 'Work order WO-2026-118 closed; hose replaced + 24h leak check passed.',
     v_admin_id, v_admin_id),
    (v_action_open_id, v_tenant_id, v_inc_injury_id,
     'preventive', 'administrative', 'Add automated PM-trigger schedule for every forklift hydraulic hose; tie to fleet-management software.',
     v_admin_id, now() + interval '21 days', 'in_progress',
     null, null, null, null,
     v_admin_id, v_admin_id),
    (v_action_ppe_id, v_tenant_id, v_inc_injury_id,
     'preventive', 'ppe', 'Issue slip-resistant overshoes to forklift operators; refresh training on PPE selection.',
     v_member_id, now() + interval '7 days', 'open',
     null, null, null, null,
     v_admin_id, v_admin_id)
  on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO6 — closed investigation (Fishbone) published as a lesson + 300 log
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary,
    sequence_of_events, immediate_causes, underlying_causes, root_causes,
    lessons_learned,
    publish_lesson, lesson_summary, lesson_published_at, lesson_published_by,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_closed_id, v_tenant_id, v_inc_closed_id, 'fishbone',
    now() - interval '90 days', now() - interval '70 days', now() - interval '70 days',
    v_admin_id,
    'Eye injury at the grinder station; in scope: PPE compliance + station signage.',
    'Worker started grind without face shield; metal sliver flicked into right eye within 30 seconds.',
    'No face shield worn; station signage faded and ambiguous.',
    'PPE was kept in a different cabinet not adjacent to the grinder; signage hadn''t been refreshed since 2019.',
    'PPE-availability: barrier-style point-of-use access not enforced.',
    e'Co-locate face-shields at every grinder station, refresh signage to OSHA 1910.215 standard, and add station as a stop on weekly safety walks.',
    true,
    e'Position PPE at the point of use, not in a central cabinet. A face shield five steps away might as well not exist. Refresh faded signage on a yearly cadence.',
    now() - interval '70 days', v_admin_id,
    v_admin_id, now() - interval '70 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_fishbone (tenant_id, investigation_id, category, cause, ordinal, is_root)
  select v_tenant_id, v_inv_closed_id, x.category, x.cause, x.ordinal, x.is_root
    from (values
      ('people'::text,     'Worker skipped face shield to save time',                       0, false),
      ('process',          'No point-of-use PPE check built into the grind task',            1, false),
      ('environment',      'Faded, ambiguous PPE signage at the station',                    2, false),
      ('management',       'PPE stored in a central cabinet, not at the grinder',            3, true)
    ) as x(category, cause, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_fishbone where investigation_id = v_inv_closed_id);

  insert into public.incident_classifications (
    tenant_id, incident_id,
    is_work_related, is_new_case, meets_recording_criteria,
    classification, is_privacy_case,
    decision_path,
    classified_by, classified_at, human_overrode_ai
  ) values (
    v_tenant_id, v_inc_closed_id,
    true, true, true,
    'other_recordable', false,
    jsonb_build_array(
      jsonb_build_object('question','Was the case work-related? (1904.5)','answer','yes'),
      jsonb_build_object('question','Is this a new case (not a continuation of an existing recorded case)? (1904.6)','answer','yes'),
      jsonb_build_object('question','Did the case result in death?','answer','no'),
      jsonb_build_object('question','Did the case result in days away from work?','answer','no'),
      jsonb_build_object('question','Did the case result in restricted work or job transfer?','answer','no'),
      jsonb_build_object('question','Was there medical treatment beyond first aid? (1904.7(b)(5))','answer','yes')
    ),
    v_admin_id, now() - interval '89 days', false
  ) on conflict (incident_id) do nothing;

  insert into public.osha_300_log_entries (
    tenant_id, establishment_id, incident_id, year,
    case_number, employee_name, job_title, date_of_injury,
    location_text, injury_description,
    classification, days_away, days_restricted, injury_type, is_privacy_case
  ) values (
    v_tenant_id, v_establishment_id, v_inc_closed_id, extract(year from now() - interval '90 days')::int,
    'INC-2025-DEMO6', 'Sam Garcia', 'Maintenance technician', (now() - interval '90 days')::date,
    'Maintenance shop — grinder station', 'Metal sliver to right eye while grinding without face shield.',
    'other_recordable', 0, 0, 'injury', false
  ) on conflict (incident_id, year) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO2 — investigation (ICAM, completed)
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_nm_id, v_tenant_id, v_inc_near_miss_id, 'icam',
    now() - interval '7 days', now() - interval '5 days', now() - interval '5 days',
    v_admin_id,
    'High-potential near-miss: pallet nearly tipped from a forklift. In scope: stopping technique + load securement.',
    'Forklift braked hard in Aisle 4; an unstrapped pallet shifted to the edge; operator caught it by hand.',
    'Abrupt stop with an unsecured load.',
    'Operator under time pressure; no load-securement standard for short moves.',
    'Production schedule rewards speed over standard work for in-aisle moves.',
    v_admin_id, now() - interval '5 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_icam_factors (tenant_id, investigation_id, layer, factor, evidence, ordinal, is_root)
  select v_tenant_id, v_inv_nm_id, x.layer, x.factor, x.evidence, x.ordinal, x.is_root
    from (values
      ('absent_failed_defences'::text, 'No load-securement standard for short in-aisle moves', 'Procedure review found no requirement', 0, false),
      ('individual_team_actions',      'Operator stopped abruptly with an unsecured load',    'Operator statement',                    1, false),
      ('task_environmental_conditions','Time pressure to clear the aisle before next pick',   'Shift huddle notes',                    2, false),
      ('organisational_factors',       'Throughput targets reward speed over standard work',  'KPI board emphasises picks/hour',       3, true)
    ) as x(layer, factor, evidence, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_icam_factors where investigation_id = v_inv_nm_id);

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO4 — investigation (TapRooT, completed)
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    created_by, updated_by
  ) values (
    v_inv_env_id, v_tenant_id, v_inc_environmental_id, 'taproot',
    now() - interval '3 days', now() - interval '1 day', now() - interval '1 day',
    v_admin_id,
    'Chlorine release onto containment. In scope: hose integrity + inspection program.',
    'A chlorine transfer hose split at a crimp; solution discharged onto the secondary containment pad and was contained.',
    'Hose failure at a crimped fitting.',
    'Chemical-hose inspection interval was annual; this hose was 18 months in service.',
    'No condition-based replacement program for chemical transfer hoses.',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_taproot_factors (id, tenant_id, investigation_id, parent_id, factor_type, description, taproot_category, ordinal, is_root)
  select x.id, v_tenant_id, v_inv_env_id, x.parent_id, x.factor_type, x.description, x.taproot_category, x.ordinal, x.is_root
    from (values
      ('11111111-aaaa-dddd-1111-000000000001'::uuid, null::uuid,                                      'event'::text,        'Chlorine solution released onto containment pad', null::text,        0, false),
      ('11111111-aaaa-dddd-1111-000000000002'::uuid, '11111111-aaaa-dddd-1111-000000000001'::uuid,    'condition',          'Transfer hose split at a crimped fitting',         null,              1, false),
      ('11111111-aaaa-dddd-1111-000000000003'::uuid, '11111111-aaaa-dddd-1111-000000000002'::uuid,    'causal_factor',      'Hose in service 18 months past its rating',        null,              2, false),
      ('11111111-aaaa-dddd-1111-000000000004'::uuid, '11111111-aaaa-dddd-1111-000000000003'::uuid,    'root_cause',         'No condition-based hose replacement program',      'procedures',      3, true)
    ) as x(id, parent_id, factor_type, description, taproot_category, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_taproot_factors where investigation_id = v_inv_env_id);

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO8 — injured person + classification (RECORDABLE restricted) + care + 300 log + investigation
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_people (
    id, tenant_id, incident_id,
    person_role, full_name, email,
    employment_type, job_title, hire_date,
    body_part, injury_nature, injury_source,
    is_primary
  ) values (
    v_person_back_id, v_tenant_id, v_inc_back_id,
    'injured', 'Jordan Demo', 'jordan.demo@example.com',
    'employee', 'Maintenance technician', current_date - interval '6 years',
    array['back_lower'], 'strain', 'manual material handling',
    true
  ) on conflict (id) do nothing;

  insert into public.incident_classifications (
    tenant_id, incident_id,
    is_work_related, is_new_case, meets_recording_criteria,
    classification, is_privacy_case,
    decision_path,
    classified_by, classified_at, human_overrode_ai
  ) values (
    v_tenant_id, v_inc_back_id,
    true, true, true,
    'restricted', false,
    jsonb_build_array(
      jsonb_build_object('question','Was the case work-related? (1904.5)','answer','yes'),
      jsonb_build_object('question','Is this a new case? (1904.6)','answer','yes'),
      jsonb_build_object('question','Did the case result in death?','answer','no'),
      jsonb_build_object('question','Did the case result in days away from work?','answer','no'),
      jsonb_build_object('question','Did the case result in restricted work or job transfer?','answer','yes','reason','8 day(s) restricted')
    ),
    v_admin_id, now() - interval '44 days', false
  ) on conflict (incident_id) do nothing;

  insert into public.incident_care_cases (
    id, tenant_id, incident_id, person_id,
    case_status, initial_visit_at, treating_physician, clinic_name, diagnosis,
    days_away_from_work, days_restricted, days_lost,
    return_to_work_at, modified_duty_start, modified_duty_end,
    restrictions, drug_test_status, drug_test_at,
    case_manager_user_id, created_by, updated_by
  ) values (
    v_care_back_id, v_tenant_id, v_inc_back_id, v_person_back_id,
    'full_duty_returned', now() - interval '44 days',
    'Dr. Lena Park', 'Springfield Occ-Med Clinic',
    'Lumbar strain; no radiculopathy. PT + activity modification.',
    0, 8, 0,
    now() - interval '30 days', now() - interval '44 days', now() - interval '30 days',
    array['No lifting > 15 lb', 'Use mechanical lift aids'],
    'negative', now() - interval '44 days',
    v_admin_id, v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.osha_300_log_entries (
    tenant_id, establishment_id, incident_id, year,
    case_number, employee_name, job_title, date_of_injury,
    location_text, injury_description,
    classification, days_away, days_restricted, injury_type, is_privacy_case
  ) values (
    v_tenant_id, v_establishment_id, v_inc_back_id, extract(year from now() - interval '45 days')::int,
    'INC-2026-DEMO8', 'Jordan Demo', 'Maintenance technician', (now() - interval '45 days')::date,
    'Maintenance shop — conveyor bay', 'Lower-back strain lifting a 60 lb gearbox by hand; restricted duty.',
    'restricted', 0, 8, 'injury', false
  ) on conflict (incident_id, year) do nothing;

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes, lessons_learned,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_back_id, v_tenant_id, v_inc_back_id, '5_whys',
    now() - interval '44 days', now() - interval '32 days', now() - interval '30 days',
    v_admin_id,
    'Lower-back strain during a gearbox change. In scope: lifting procedure + hoist availability.',
    'Tech removed a 60 lb gearbox by hand rather than rigging the overhead hoist, and felt a back strain mid-lift.',
    'Manual lift of a load above the safe two-person limit.',
    'Hoist was available but slower; no enforced threshold requiring mechanical assist.',
    'No defined manual-lift weight limit tied to a required lift-assist for maintenance tasks.',
    'Set a hard manual-lift limit and pre-stage lift assists at high-frequency repair points.',
    v_admin_id, now() - interval '30 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_5whys (tenant_id, investigation_id, ordinal, question, answer, is_root) values
    (v_tenant_id, v_inv_back_id, 1, 'What happened?',                   'Tech strained their lower back lifting a gearbox.',        false),
    (v_tenant_id, v_inv_back_id, 2, 'Why lift it by hand?',             'The overhead hoist felt slower than just lifting it.',     false),
    (v_tenant_id, v_inv_back_id, 3, 'Why choose speed over the hoist?', 'No rule required a lift assist above a weight threshold.',  false),
    (v_tenant_id, v_inv_back_id, 4, 'Why no threshold rule?',           'Manual-handling SOP never set a maintenance lift limit.',   false),
    (v_tenant_id, v_inv_back_id, 5, 'Why was the SOP incomplete?',      'Maintenance tasks were excluded from the ergonomics review.', true)
  on conflict (investigation_id, ordinal) do nothing;

  insert into public.incident_actions (
    id, tenant_id, incident_id,
    action_type, hierarchy_of_controls, description,
    owner_user_id, due_at, status,
    completed_at, verified_at, verified_by, verification_evidence,
    created_by, updated_by
  ) values
    (v_action_back1_id, v_tenant_id, v_inc_back_id,
     'corrective', 'engineering', 'Pre-stage portable lift assists at the three highest-frequency gearbox change points.',
     v_admin_id, now() - interval '25 days', 'verified',
     now() - interval '27 days', now() - interval '25 days', v_owner_id, 'Lift assists installed + photo verified at all three points.',
     v_admin_id, v_admin_id),
    (v_action_back2_id, v_tenant_id, v_inc_back_id,
     'preventive', 'administrative', 'Set a 50 lb manual-lift limit in the maintenance SOP requiring a mechanical assist above it.',
     v_admin_id, now() - interval '15 days', 'complete',
     now() - interval '18 days', null, null, null,
     v_admin_id, v_admin_id)
  on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO9 — investigation (Fishbone, completed) + CAPA
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_totes_id, v_tenant_id, v_inc_totes_id, 'fishbone',
    now() - interval '30 days', now() - interval '26 days', now() - interval '24 days',
    v_admin_id,
    'Toppled totes near the pack line. In scope: cart loading + stacking limits.',
    'An overloaded cart with totes stacked five high toppled when pushed over a floor transition.',
    'Cart overloaded and stacked beyond a stable height.',
    'No posted cart load/height limit; floor transition created a tipping moment.',
    'Material-handling standard never defined cart limits for the pack area.',
    v_admin_id, now() - interval '24 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_fishbone (tenant_id, investigation_id, category, cause, ordinal, is_root)
  select v_tenant_id, v_inv_totes_id, x.category, x.cause, x.ordinal, x.is_root
    from (values
      ('process'::text,   'No posted cart load or stack-height limit',        0, true),
      ('environment',     'Uneven floor transition near the pack line',       1, false),
      ('people',          'Operator stacked totes five high to save trips',   2, false),
      ('equipment',       'Cart lacked side rails to contain the load',       3, false)
    ) as x(category, cause, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_fishbone where investigation_id = v_inv_totes_id);

  insert into public.incident_actions (
    id, tenant_id, incident_id,
    action_type, hierarchy_of_controls, description,
    owner_user_id, due_at, status,
    completed_at, verified_at, verified_by, verification_evidence,
    created_by, updated_by
  ) values
    (v_action_totes_id, v_tenant_id, v_inc_totes_id,
     'corrective', 'administrative', 'Post a cart load + stack-height limit at the pack-out station and brief the crew.',
     v_member_id, now() - interval '20 days', 'verified',
     now() - interval '22 days', now() - interval '20 days', v_admin_id, 'Limit sign posted; toolbox talk logged.',
     v_admin_id, v_admin_id)
  on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO10 — investigation (TapRooT, completed) + CAPA
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_arc_id, v_tenant_id, v_inc_arc_id, 'taproot',
    now() - interval '60 days', now() - interval '54 days', now() - interval '52 days',
    v_admin_id,
    'Live-panel entry near-miss. In scope: energized-work authorization + verification.',
    'A technician opened an energized 480V panel to troubleshoot without an energized-work permit or voltage verification.',
    'Energized panel opened without de-energization or verification.',
    'Production pressure to restore the line; LOTO felt like it would take too long.',
    'Energized-work permit process not enforced for "quick" troubleshooting.',
    v_admin_id, now() - interval '52 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_taproot_factors (id, tenant_id, investigation_id, parent_id, factor_type, description, taproot_category, ordinal, is_root)
  select x.id, v_tenant_id, v_inv_arc_id, x.parent_id, x.factor_type, x.description, x.taproot_category, x.ordinal, x.is_root
    from (values
      ('11111111-aaaa-dddd-2222-000000000001'::uuid, null::uuid,                                   'event'::text,   'Energized 480V panel opened to troubleshoot', null::text,         0, false),
      ('11111111-aaaa-dddd-2222-000000000002'::uuid, '11111111-aaaa-dddd-2222-000000000001'::uuid, 'condition',     'No voltage verification before opening',      null,               1, false),
      ('11111111-aaaa-dddd-2222-000000000003'::uuid, '11111111-aaaa-dddd-2222-000000000002'::uuid, 'causal_factor', 'Energized-work permit skipped for speed',     null,               2, false),
      ('11111111-aaaa-dddd-2222-000000000004'::uuid, '11111111-aaaa-dddd-2222-000000000003'::uuid, 'root_cause',    'Permit process not enforced for quick fixes', 'procedures',       3, true)
    ) as x(id, parent_id, factor_type, description, taproot_category, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_taproot_factors where investigation_id = v_inv_arc_id);

  insert into public.incident_actions (
    id, tenant_id, incident_id,
    action_type, hierarchy_of_controls, description,
    owner_user_id, due_at, status,
    completed_at, verified_at, verified_by, verification_evidence,
    created_by, updated_by
  ) values
    (v_action_arc_id, v_tenant_id, v_inc_arc_id,
     'corrective', 'administrative', 'Require an energized-work permit + voltage verification for ANY panel entry; audit weekly for 8 weeks.',
     v_admin_id, now() - interval '40 days', 'verified',
     now() - interval '44 days', now() - interval '40 days', v_owner_id, 'Permit form rolled out; first 4 weekly audits passed.',
     v_admin_id, v_admin_id)
  on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO11 — investigation (ICAM, completed) + CAPA
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_crane_id, v_tenant_id, v_inc_crane_id, 'icam',
    now() - interval '75 days', now() - interval '60 days', now() - interval '55 days',
    v_admin_id,
    'Dropped die from an overhead crane. In scope: rigging inspection + lift planning.',
    'A sling slipped during a die lift; the die fell to the floor. The lift zone was clear.',
    'Sling slipped off the load during the lift.',
    'Sling was not inspected before use; no lift plan for the irregular load.',
    'Rigging pre-use inspection and lift planning not part of the die-change standard.',
    v_admin_id, now() - interval '55 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_icam_factors (tenant_id, investigation_id, layer, factor, evidence, ordinal, is_root)
  select v_tenant_id, v_inv_crane_id, x.layer, x.factor, x.evidence, x.ordinal, x.is_root
    from (values
      ('absent_failed_defences'::text, 'No rigging pre-use inspection step',          'Standard work lacked the step', 0, false),
      ('individual_team_actions',      'Sling positioned without a load check',       'Rigger interview',              1, false),
      ('task_environmental_conditions','Irregular die shape, no lift plan',           'Job had no documented plan',    2, false),
      ('organisational_factors',       'Die-change standard omitted rigging controls','Procedure audit',               3, true)
    ) as x(layer, factor, evidence, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_icam_factors where investigation_id = v_inv_crane_id);

  insert into public.incident_actions (
    id, tenant_id, incident_id,
    action_type, hierarchy_of_controls, description,
    owner_user_id, due_at, status,
    completed_at, verified_at, verified_by, verification_evidence,
    created_by, updated_by
  ) values
    (v_action_crane_id, v_tenant_id, v_inc_crane_id,
     'corrective', 'engineering', 'Add a rigging pre-use inspection + written lift plan to the die-change standard; tag-color slings by inspection month.',
     v_admin_id, now() - interval '45 days', 'verified',
     now() - interval '48 days', now() - interval '45 days', v_owner_id, 'Standard updated; sling tag-color system in place.',
     v_admin_id, v_admin_id)
  on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO12 — investigation (5 Whys, completed)
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at, completed_at,
    lead_investigator, scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    signoff_by, signoff_at, signoff_typed_name,
    created_by, updated_by
  ) values (
    v_inv_oil_id, v_tenant_id, v_inc_oil_id, '5_whys',
    now() - interval '120 days', now() - interval '110 days', now() - interval '100 days',
    v_admin_id,
    'Minor oil sheen reached a storm drain. In scope: spill-kit placement + drain protection.',
    'A leaking yard fitting let ~2 gal of hydraulic oil reach the storm-drain grate before booms were placed.',
    'Slow response placing absorbent booms / drain protection.',
    'Spill kit was stored across the yard; no drain-cover pre-staged at the dock.',
    'No spill-response staging plan for the outdoor dock area.',
    v_admin_id, now() - interval '100 days', 'Pat Owens',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_5whys (tenant_id, investigation_id, ordinal, question, answer, is_root) values
    (v_tenant_id, v_inv_oil_id, 1, 'What happened?',                'Oil sheen reached the storm drain.',                  false),
    (v_tenant_id, v_inv_oil_id, 2, 'Why did it reach the drain?',  'Booms were not placed fast enough.',                  false),
    (v_tenant_id, v_inv_oil_id, 3, 'Why the slow response?',       'The spill kit was stored across the yard.',           false),
    (v_tenant_id, v_inv_oil_id, 4, 'Why no kit nearby?',           'No staging plan for the outdoor dock.',               false),
    (v_tenant_id, v_inv_oil_id, 5, 'Why no staging plan?',         'Spill-response plan only covered indoor process areas.', true)
  on conflict (investigation_id, ordinal) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- DEMO13 — investigation (Fishbone, OPEN / in-progress)
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at,
    lead_investigator, team_member_ids, scope_summary, sequence_of_events,
    immediate_causes,
    created_by, updated_by
  ) values (
    v_inv_ped_id, v_tenant_id, v_inc_ped_id, 'fishbone',
    now() - interval '9 days', now() + interval '5 days',
    v_admin_id, array[v_admin_id, v_member_id],
    'Pedestrian / forklift near-miss at a blind corner. In scope: traffic separation + sightlines.',
    'A forklift and a pedestrian converged at the Aisle 1 blind corner; the driver stopped within a foot.',
    'No physical separation or sightline aid at the blind corner.',
    v_admin_id, v_admin_id
  ) on conflict (id) do nothing;

  insert into public.incident_rca_fishbone (tenant_id, investigation_id, category, cause, ordinal, is_root)
  select v_tenant_id, v_inv_ped_id, x.category, x.cause, x.ordinal, x.is_root
    from (values
      ('environment'::text, 'Blind corner with no convex mirror',              0, false),
      ('process',           'No designated pedestrian walkway in the aisle',   1, false),
      ('equipment',         'Forklift travel speed not limited near corners',  2, false)
    ) as x(category, cause, ordinal, is_root)
   where not exists (select 1 from public.incident_rca_fishbone where investigation_id = v_inv_ped_id);

  -- ────────────────────────────────────────────────────────────────────
  -- Notification log (a few "alert sent" rows for the Notifications card).
  -- incident_notifications has no natural unique key (PK is a random uuid),
  -- so a bare ON CONFLICT can't de-dupe — guard on (incident, trigger,
  -- recipient) so repeated Reset Demo runs don't pile up duplicate rows.
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_notifications (
    tenant_id, incident_id, trigger_type, channel,
    recipient_user_id, recipient_email, status
  )
  select v_tenant_id, v.incident_id, v.trigger_type, 'email',
         v.recipient_user_id, v.recipient_email, 'sent'
    from (values
      (v_inc_injury_id,        'initial'::text,    v_admin_id, 'admin@demo.example'),
      (v_inc_injury_id,        'escalation',       v_owner_id, 'owner@demo.example'),
      (v_inc_environmental_id, 'initial',          v_admin_id, 'admin@demo.example'),
      (v_inc_anon_id,          'initial',          v_admin_id, 'admin@demo.example'),
      (v_inc_arc_id,           'initial',          v_admin_id, 'admin@demo.example'),
      (v_inc_back_id,          'initial',          v_admin_id, 'admin@demo.example')
    ) as v(incident_id, trigger_type, recipient_user_id, recipient_email)
   where not exists (
     select 1 from public.incident_notifications n
      where n.tenant_id        = v_tenant_id
        and n.incident_id       = v.incident_id
        and n.trigger_type      = v.trigger_type
        and n.recipient_user_id = v.recipient_user_id
   );

  -- ────────────────────────────────────────────────────────────────────
  -- 300A annual summary — upserted to the 3-recordable current-year
  -- picture so the OSHA page + YoY chart agree with the live KPI panel.
  --   recordables: 1 days_away (DEMO1) + 1 restricted (DEMO8) + 1 other (DEMO6)
  --   days away count: 5 (DEMO1); days restricted count: 8 (DEMO8)
  -- ────────────────────────────────────────────────────────────────────

  v_summary := jsonb_build_object(
    'year', v_year,
    'total_deaths', 0,
    'total_days_away', 1,
    'total_restricted', 1,
    'total_other_recordable', 1,
    'total_days_away_count', 5,
    'total_days_restricted_count', 8,
    'by_injury_type', jsonb_build_object(
      'injury', 3, 'skin_disorder', 0, 'respiratory', 0,
      'poisoning', 0, 'hearing_loss', 0, 'other_illness', 0
    ),
    'total_hours_worked', 96720,
    'annual_avg_employees', 47
  );

  insert into public.osha_annual_summaries (
    tenant_id, establishment_id, year,
    totals_json, total_hours_worked, annual_avg_employees
  ) values (
    v_tenant_id, v_establishment_id, v_year,
    v_summary, 96720, 47
  ) on conflict (tenant_id, establishment_id, year)
    do update set totals_json          = excluded.totals_json,
                  total_hours_worked    = excluded.total_hours_worked,
                  annual_avg_employees  = excluded.annual_avg_employees;

  return format('Seeded WLS incidents demo: 13 incidents, 10 investigations, 3 recordable (tenant %s)', v_tenant_id);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2. seed_wls_near_miss_demo() — dedicated Near-Miss module reports.
--    Independent of the incident "near_miss" type; populates the
--    Near-Miss report list with a reporting-culture spread.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.seed_wls_near_miss_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_owner_id  uuid;
  v_member_id uuid;
begin
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    return '[seed_wls_near_miss_demo] skipped — no is_demo=true tenant';
  end if;

  select tm.user_id into v_owner_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
   order by case tm.role when 'owner' then 0 when 'admin' then 1 else 2 end, tm.created_at asc
   limit 1;
  if v_owner_id is null then
    return '[seed_wls_near_miss_demo] skipped — no tenant_memberships on demo tenant';
  end if;

  select tm.user_id into v_member_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id and tm.user_id <> v_owner_id
   order by tm.created_at asc
   limit 1;
  if v_member_id is null then v_member_id := v_owner_id; end if;

  -- Explicit report_number + deterministic id → idempotent. The
  -- set_near_miss_number() trigger leaves a provided report_number alone.
  insert into public.near_misses (
    id, tenant_id, report_number, occurred_at, reported_at, reported_by,
    location, description, immediate_action_taken,
    hazard_category, severity_potential, status, assigned_to,
    resolved_at, resolution_notes, created_at
  ) values
    ('33333333-aaaa-bbbb-cccc-000000000001', v_tenant_id, 'NM-2026-DEMO1',
     now() - interval '4 days', now() - interval '4 days', v_member_id,
     'Production Floor — Mixer 2', 'Guard interlock was bypassed with tape; caught during a walk-through before anyone reached in.',
     'Tape removed; interlock function-tested; supervisor notified.',
     'mechanical', 'high', 'triaged', v_owner_id,
     null, null, now() - interval '4 days'),
    ('33333333-aaaa-bbbb-cccc-000000000002', v_tenant_id, 'NM-2026-DEMO2',
     now() - interval '9 days', now() - interval '9 days', v_member_id,
     'Warehouse — Aisle 6', 'Stacked pallets leaning ~10°; could have toppled into the walkway.',
     'Pallets restacked; load limit reviewed with crew.',
     'physical', 'moderate', 'closed', v_owner_id,
     now() - interval '7 days', 'Restacked and re-trained; no further action.', now() - interval '9 days'),
    ('33333333-aaaa-bbbb-cccc-000000000003', v_tenant_id, 'NM-2026-DEMO3',
     now() - interval '15 days', now() - interval '15 days', v_member_id,
     'Maintenance shop — parts washer', 'Solvent stored next to an ignition source; no spill containment.',
     'Solvent relocated to the flammables cabinet.',
     'chemical', 'high', 'investigating', v_owner_id,
     null, null, now() - interval '15 days'),
    ('33333333-aaaa-bbbb-cccc-000000000004', v_tenant_id, 'NM-2026-DEMO4',
     now() - interval '21 days', now() - interval '21 days', v_member_id,
     'Loading Dock A', 'Trailer began to creep during loading; wheel chocks were not set.',
     'Forklift backed out; chocks set; dock-lock checked.',
     'physical', 'extreme', 'escalated_to_risk', v_owner_id,
     null, null, now() - interval '21 days'),
    ('33333333-aaaa-bbbb-cccc-000000000005', v_tenant_id, 'NM-2026-DEMO5',
     now() - interval '33 days', now() - interval '33 days', v_member_id,
     'Electrical room', 'Extension cord daisy-chained to a space heater; cord warm to the touch.',
     'Cord removed from service; heater plugged into a dedicated circuit.',
     'electrical', 'high', 'closed', v_owner_id,
     now() - interval '30 days', 'Removed daisy-chain; added circuit.', now() - interval '33 days'),
    ('33333333-aaaa-bbbb-cccc-000000000006', v_tenant_id, 'NM-2026-DEMO6',
     now() - interval '47 days', now() - interval '47 days', v_member_id,
     'Packaging — Line A', 'Repeated reaching into a pinch point to clear jams without LOTO.',
     'Coached operator; jam-clear procedure posted.',
     'ergonomic', 'moderate', 'closed', v_owner_id,
     now() - interval '44 days', 'Procedure posted; spot-checks added.', now() - interval '47 days'),
    ('33333333-aaaa-bbbb-cccc-000000000007', v_tenant_id, 'NM-2026-DEMO7',
     now() - interval '2 days', now() - interval '2 days', v_member_id,
     'Yard', 'Pedestrian crossed the forklift travel lane outside the marked walkway.',
     'Reminder issued; walkway striping refresh requested.',
     'physical', 'moderate', 'new', null,
     null, null, now() - interval '2 days')
  on conflict (id) do nothing;

  return format('Seeded WLS near-miss demo: 7 reports (tenant %s)', v_tenant_id);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. seed_wls_bbs_demo() — Behavior-Based Safety QR locations + observations.
--    Promotes the standalone seed_bbs_demo.sql to a function so Reset Demo
--    (which wipes bbs_observations) restores it.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.seed_wls_bbs_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id    uuid;
  v_owner_id     uuid;

  v_qr_dock      uuid := '22222222-bbbb-cccc-dddd-000000000001';
  v_qr_floor     uuid := '22222222-bbbb-cccc-dddd-000000000002';
  v_qr_warehouse uuid := '22222222-bbbb-cccc-dddd-000000000003';
  v_qr_shop      uuid := '22222222-bbbb-cccc-dddd-000000000004';

  v_obs_1 uuid := '22222222-bbbb-cccc-eeee-000000000001';
  v_obs_2 uuid := '22222222-bbbb-cccc-eeee-000000000002';
  v_obs_3 uuid := '22222222-bbbb-cccc-eeee-000000000003';
  v_obs_4 uuid := '22222222-bbbb-cccc-eeee-000000000004';
  v_obs_5 uuid := '22222222-bbbb-cccc-eeee-000000000005';
  v_obs_6 uuid := '22222222-bbbb-cccc-eeee-000000000006';
  v_obs_7 uuid := '22222222-bbbb-cccc-eeee-000000000007';
  v_obs_8 uuid := '22222222-bbbb-cccc-eeee-000000000008';
begin
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    return '[seed_wls_bbs_demo] skipped — no is_demo=true tenant';
  end if;

  select tm.user_id into v_owner_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
   order by case tm.role when 'owner' then 0 when 'admin' then 1 else 2 end, tm.created_at asc
   limit 1;
  if v_owner_id is null then
    return '[seed_wls_bbs_demo] skipped — no tenant_memberships on demo tenant';
  end if;

  insert into public.bbs_qr_locations (id, tenant_id, name, area, description, token, active, created_by, updated_by)
  values
    (v_qr_dock,      v_tenant_id, 'Loading Dock A',    'Shipping',      'Forklift staging + truck bays 1-4',
     'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1', true, v_owner_id, v_owner_id),
    (v_qr_floor,     v_tenant_id, 'Production Floor',  'Manufacturing', 'Main packaging line, mixers, conveyors',
     'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', true, v_owner_id, v_owner_id),
    (v_qr_warehouse, v_tenant_id, 'Warehouse Aisle 3', 'Warehouse',     'Pallet racking — high-bay storage',
     'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3', true, v_owner_id, v_owner_id),
    (v_qr_shop,      v_tenant_id, 'Maintenance Shop',  'Maintenance',   'Welding bay, tool crib, parts washer',
     'b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4', true, v_owner_id, v_owner_id)
  on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, immediate_action_taken,
    severity, likelihood, status, created_at
  ) values (
    v_obs_1, v_tenant_id, v_owner_id, v_qr_floor,
    now() - interval '2 hours', 'Production Floor — Mixer 2', 'Manufacturing',
    'unsafe_act', 'PPE',
    'Operator removed cut-resistant gloves while clearing a jam on Mixer 2 — direct exposure to rotating auger.',
    'Stopped operator, restarted LOTO sequence, replaced gloves before resuming.',
    'high', 'medium', 'open', now() - interval '2 hours'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, severity, likelihood, status,
    assigned_to, due_date, corrective_action, created_at
  ) values (
    v_obs_2, v_tenant_id, v_owner_id, v_qr_warehouse,
    now() - interval '1 day', 'Warehouse Aisle 3 — Bay 14', 'Warehouse',
    'unsafe_condition', 'Housekeeping',
    'Damaged pallet rack upright (bay 14, level 2) — visible deflection ~25mm. Loaded with 1100 lb of finished goods.',
    'high', 'high', 'in_progress',
    v_owner_id, (current_date + 3)::date,
    'Engineering ordered replacement upright; bay 14 cordoned off and load redistributed to bays 12/16.',
    now() - interval '1 day'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, status, created_at
  ) values (
    v_obs_3, v_tenant_id, v_owner_id, v_qr_dock,
    now() - interval '3 hours', 'Loading Dock A — Bay 2', 'Shipping',
    'safe_behavior', 'PPE',
    'Forklift driver performed full pre-op inspection (horn, brakes, mast tilt) and signed checklist before first lift.',
    'open', now() - interval '3 hours'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, submitted_name, submitted_email, qr_location_id,
    observed_at, location_text, department, kind, category,
    description, severity, likelihood, status, created_at
  ) values (
    v_obs_4, v_tenant_id, null, 'Anonymous', null, v_qr_shop,
    now() - interval '5 hours', 'Maintenance Shop — Welding Bay 1', 'Maintenance',
    'unsafe_condition', 'Fire',
    'Oxy-acetylene cart left unsecured next to grinding station; cylinders not chained, regulator leaking soap-test bubbles.',
    'high', 'medium', 'open', now() - interval '5 hours'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, severity, likelihood, status,
    assigned_to, corrective_action, closed_at, closed_by, created_at
  ) values (
    v_obs_5, v_tenant_id, v_owner_id, v_qr_floor,
    now() - interval '8 days', 'Production Floor — Line 4', 'Manufacturing',
    'unsafe_act', 'Ergonomics',
    'Operator twisting at waist to lift 18 kg cases off the conveyor (~40 cycles/hour) instead of using the lift assist.',
    'medium', 'medium', 'closed',
    v_owner_id,
    'Coached operator on lift-assist procedure; supervisor added daily ergo check-in for first 5 days.',
    now() - interval '5 days', v_owner_id, now() - interval '8 days'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, status, created_at
  ) values (
    v_obs_6, v_tenant_id, v_owner_id, v_qr_warehouse,
    now() - interval '4 days', 'Warehouse Aisle 3', 'Warehouse',
    'safe_behavior', 'Housekeeping',
    'Picker stopped to wipe up hydraulic-fluid drip from a forklift before continuing — prevented a slip hazard in a high-traffic aisle.',
    'open', now() - interval '4 days'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, severity, likelihood, status,
    corrective_action, closed_at, closed_by, created_at
  ) values (
    v_obs_7, v_tenant_id, v_owner_id, v_qr_dock,
    now() - interval '12 days', 'Loading Dock A — common area', 'Shipping',
    'unsafe_condition', 'Lighting',
    'One of two LED high-bays out at the dock-bay 3 entry; reduced visibility for backing trucks during early shift.',
    'low', 'medium', 'closed',
    'Maintenance replaced fixture same day; added quarterly lighting walk to PM schedule.',
    now() - interval '11 days', v_owner_id, now() - interval '12 days'
  ) on conflict (id) do nothing;

  insert into public.bbs_observations (
    id, tenant_id, submitted_by, qr_location_id, observed_at, location_text, department,
    kind, category, description, immediate_action_taken,
    abc_antecedent, abc_behavior, abc_consequence,
    severity, likelihood, status, created_at
  ) values (
    v_obs_8, v_tenant_id, v_owner_id, v_qr_shop,
    now() - interval '6 hours', 'Maintenance Shop — Tool Crib', 'Maintenance',
    'unsafe_act', 'LOTO',
    'Tech began troubleshooting starter on Conveyor 7 without applying personal lock; relied on disconnect being open.',
    'Stop-work issued; full LOTO applied before resuming.',
    'Time pressure to clear backlog before shift change; supervisor not on floor.',
    'Skipped personal lock, verified disconnect by sight only — no try-out.',
    'No injury — but LOTO program audit triggered; refresher scheduled for shop crew.',
    'medium', 'high', 'open', now() - interval '6 hours'
  ) on conflict (id) do nothing;

  insert into public.bbs_observation_actions (tenant_id, observation_id, action_type, body, created_at, created_by)
  select v_tenant_id, v_obs_2, 'comment',
         'Engineering quote received — replacement upright on order, ETA 3 business days.',
         now() - interval '18 hours', v_owner_id
  where not exists (
    select 1 from public.bbs_observation_actions
     where observation_id = v_obs_2 and action_type = 'comment' and body like 'Engineering quote received%'
  );

  insert into public.bbs_observation_actions (tenant_id, observation_id, action_type, body, meta, created_at, created_by)
  select v_tenant_id, v_obs_2, 'status_change', null,
         jsonb_build_object('from', 'open', 'to', 'in_progress'),
         now() - interval '20 hours', v_owner_id
  where not exists (
    select 1 from public.bbs_observation_actions
     where observation_id = v_obs_2 and action_type = 'status_change'
  );

  insert into public.bbs_observation_actions (tenant_id, observation_id, action_type, body, created_at, created_by)
  select v_tenant_id, v_obs_5, 'closed',
         'Coaching complete; ergo check-ins logged; operator self-reports no discomfort. Closing.',
         now() - interval '5 days', v_owner_id
  where not exists (
    select 1 from public.bbs_observation_actions
     where observation_id = v_obs_5 and action_type = 'closed'
  );

  return format('Seeded WLS BBS demo: 4 QR locations, 8 observations (tenant %s)', v_tenant_id);
end;
$$;

-- ── Lock down execute to match migration 124's hardening posture. The
--    service_role used by the reset route still executes them (same as
--    seed_wls_demo, which is revoked here yet called by the route). ──────
revoke execute on function public.seed_wls_incidents_demo() from anon, authenticated, public;
revoke execute on function public.seed_wls_near_miss_demo() from anon, authenticated, public;
revoke execute on function public.seed_wls_bbs_demo()       from anon, authenticated, public;

-- ── Seed once on apply (safe + idempotent). ──────────────────────────────
do $$
begin
  raise notice '%', public.seed_wls_incidents_demo();
  raise notice '%', public.seed_wls_near_miss_demo();
  raise notice '%', public.seed_wls_bbs_demo();
end $$;

notify pgrst, 'reload schema';

commit;
