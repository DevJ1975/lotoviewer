-- Migration 256: WLS Demo seed for the Environmental (ISO 14001) module.
--
-- WHY THIS EXISTS
-- ───────────────
-- Migrations 204-207 shipped the EMS registers (aspects & impacts,
-- objectives + readings, nonconformities + CAPA, management review) but
-- no demo tenant ever had a row in any of them, so the module — and the
-- audit-readiness report card that reads it — demoed empty.
--
-- Called by Reset Demo (POST /api/superadmin/tenants/0002/reset-demo)
-- alongside the other seed_wls_*_demo() functions.
--
-- REPORT-CARD RECONCILIATION
-- ──────────────────────────
-- The report card (packages/core/src/iso14001Readiness.ts) grades 19
-- clauses from these registers. The data below is tuned so a demo shows
-- a believable mid-implementation EMS rather than a wall of green — a
-- customer learns nothing from a system that says everything is fine:
--
--   6.1.2 attention — 1 of 5 significant aspects has no control and no
--                     linked risk (Diesel bulk storage, deliberately)
--   6.1.4 attention — that same aspect has no objective either
--   6.1.3 attention — 6 obligations on the calendar, 1 already overdue
--   6.2.1 conforming — 6 objectives, all with targets, all tied to a
--                     significant aspect
--   9.1.1 attention — 1 in-progress objective has no reading in 90 days
--   9.1.2 conforming — a completed compliance-calendar event exists
--   9.3   conforming — a management review 4 months ago WITH recorded
--                     conclusions and decisions (reviewHasOutputs)
--   10.2  attention  — 1 open MAJOR nonconformity
--   10.3  conforming — verified corrective actions this period
--
-- The open major is the point: it forces the headline verdict to
-- "Not ready" no matter how high evidence coverage climbs, which is the
-- behaviour an ISO auditor would expect and the reason the report card
-- does not lead with a percentage.
--
-- Clauses 5.2, 7.5 and 9.2 read as gaps because the controlled-document
-- register and internal-audit programme are later phases. That is honest,
-- not a seeding omission — there is nowhere to put those records yet.
-- Clause 8.2 also reads as a gap: no drill or test record exists anywhere
-- in the platform to read.
--
-- This seed only owns the eight clauses listed above. Overall coverage
-- also depends on data other modules put in the tenant — risks, training
-- currency, inspections, communications — so the headline percentage is a
-- property of the whole demo tenant, not of this file.
--
-- Measured against WLS Demo (#0002) when this shipped:
--
--   7 conforming · 6 attention · 6 gap · 37% evidence coverage
--   headline: "Not ready for a certification audit — 1 open major
--              nonconformity; no evidence for clauses 7.5, 9.2."
--
-- The extra gaps are adjacent-module, not environmental: 7.4 has no
-- communication record, 8.1 has no submitted inspection, and 7.2 reads
-- attention because 45 training records have lapsed. They improve on
-- their own as the other demo seeds land — in particular migration 200's
-- seed_wls_incidents_demo / _near_miss_ / _bbs_, which were not applied
-- to this database when this migration ran.
--
-- The eight clause outcomes above are pinned by the "WLS demo seed story"
-- block in packages/core/src/__tests__/iso14001Readiness.test.ts, so a
-- change to either the seed or the scoring rules fails a test rather than
-- quietly making this comment a lie.
--
-- SEPARATION OF DUTY
-- ──────────────────
-- nonconformity_actions enforces verifier <> completer in a trigger. The
-- seed resolves two distinct demo users; if the demo tenant has only one
-- member it degrades to leaving actions completed-but-unverified rather
-- than tripping the trigger, so the seed never fails on a thin tenant.
--
-- IDEMPOTENT — deterministic ids + ON CONFLICT guards. Safe to re-run.
-- Resolves the demo tenant by tenants.is_demo = true.

begin;

create or replace function public.seed_wls_iso14001_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id  uuid;
  v_owner_id   uuid;
  v_member_id  uuid;
  v_can_verify boolean;

  v_aspect_count    int := 0;
  v_objective_count int := 0;
  v_reading_count   int := 0;
  v_review_count    int := 0;
  v_nc_count        int := 0;
  v_action_count    int := 0;
  v_oblig_count     int := 0;
  v_event_count     int := 0;
  v_pin_count       int := 0;

  -- Significant aspects the objectives hang off. Deterministic so a
  -- re-run re-links rather than duplicating.
  a_stack   uuid := 'e1a50001-0000-4000-8000-000000000001';
  a_voc     uuid := 'e1a50001-0000-4000-8000-000000000002';
  a_water   uuid := 'e1a50001-0000-4000-8000-000000000003';
  a_hazwst  uuid := 'e1a50001-0000-4000-8000-000000000004';
  a_diesel  uuid := 'e1a50001-0000-4000-8000-000000000005';

  o_stack   uuid := 'e1b60001-0000-4000-8000-000000000001';
  o_voc     uuid := 'e1b60001-0000-4000-8000-000000000002';
  o_water   uuid := 'e1b60001-0000-4000-8000-000000000003';
  o_waste   uuid := 'e1b60001-0000-4000-8000-000000000004';
  o_energy  uuid := 'e1b60001-0000-4000-8000-000000000005';
  o_recycle uuid := 'e1b60001-0000-4000-8000-000000000006';

  nc_major  uuid := 'e1c70001-0000-4000-8000-000000000001';
begin
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    return '[seed_wls_iso14001_demo] skipped — no is_demo=true tenant';
  end if;

  select tm.user_id into v_owner_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
   order by case tm.role when 'owner' then 0 when 'admin' then 1 else 2 end, tm.created_at asc
   limit 1;
  if v_owner_id is null then
    return '[seed_wls_iso14001_demo] skipped — no tenant_memberships on demo tenant';
  end if;

  select tm.user_id into v_member_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id and tm.user_id <> v_owner_id
   order by tm.created_at asc
   limit 1;
  -- Verification needs a second human. Without one the §10.2 trigger
  -- would reject the row, so the seed leaves those actions at
  -- 'completed' instead of faking a self-verification.
  v_can_verify := v_member_id is not null;
  if v_member_id is null then v_member_id := v_owner_id; end if;

  -- ─── 1. Environmental aspects (clause 6.1.2) ──────────────────────
  -- 14 aspects; significance = severity × likelihood, significant at ≥ 12.
  -- Exactly five clear that bar, and exactly one of those five is left
  -- with no control and no linked risk so the report card has something
  -- true to complain about.
  insert into public.environmental_aspects (
    id, tenant_id, activity, aspect, impact,
    life_cycle_stage, operating_condition, flow,
    severity, likelihood, controls, status, source_reference,
    owner_user_id, created_by, updated_by, created_at, updated_at
  ) values
    (a_stack, v_tenant_id, 'Boiler operation', 'Combustion stack emissions (NOx, CO)',
     'Air quality degradation and greenhouse-gas contribution',
     'operation', 'normal', 'output', 4, 4,
     'Annual burner tune-up; continuous stack monitoring; permit-limit alarms at 80% of cap.',
     'controlled', 'Permit AQMD-2291', v_owner_id, v_owner_id, v_owner_id,
     now() - interval '210 days', now() - interval '24 days'),

    (a_voc, v_tenant_id, 'Parts cleaning and coating', 'Solvent VOC evaporation',
     'Ground-level ozone formation; worker exposure',
     'operation', 'normal', 'output', 4, 3,
     'Enclosed cleaning stations; low-VOC solvent substitution programme; lids kept closed.',
     'monitored', 'Chemical inventory — solvent group', v_owner_id, v_owner_id, v_owner_id,
     now() - interval '205 days', now() - interval '31 days'),

    (a_water, v_tenant_id, 'Equipment washdown', 'Wastewater discharge to sewer',
     'Loading on the POTW; potential permit exceedance for oil and grease',
     'operation', 'normal', 'output', 3, 4,
     'Oil-water separator serviced quarterly; composite sampling monthly against permit limits.',
     'controlled', 'Permit POTW-4471', v_owner_id, v_owner_id, v_owner_id,
     now() - interval '198 days', now() - interval '45 days'),

    (a_hazwst, v_tenant_id, 'Hazardous waste accumulation', 'Storage of ignitable and corrosive waste',
     'Soil and groundwater contamination if a container fails',
     'operation', 'abnormal', 'output', 5, 3,
     'Weekly container inspections; secondary containment; 90-day accumulation clock tracked.',
     'controlled', 'RCRA generator status — LQG', v_owner_id, v_owner_id, v_owner_id,
     now() - interval '190 days', now() - interval '12 days'),

    -- Deliberately uncontrolled: no controls text, no related_risk_id,
    -- and no objective below. Drives 6.1.2 and 6.1.4 to "attention".
    (a_diesel, v_tenant_id, 'Bulk diesel storage', 'Potential release from the 2,000 gal day tank',
     'Soil and stormwater contamination; reportable-quantity release',
     'operation', 'emergency', 'output', 4, 3,
     null, 'identified', 'Tank T-114', v_owner_id, v_owner_id, v_owner_id,
     now() - interval '60 days', now() - interval '60 days'),

    ('e1a50001-0000-4000-8000-000000000006', v_tenant_id, 'Office operations', 'Paper and toner consumption',
     'Resource depletion; landfill contribution',
     'operation', 'normal', 'input', 2, 4,
     'Default duplex printing; toner take-back programme.', 'controlled', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '180 days', now() - interval '90 days'),

    ('e1a50001-0000-4000-8000-000000000007', v_tenant_id, 'Compressed air system', 'Electricity consumption',
     'Indirect greenhouse-gas emissions from generation',
     'operation', 'normal', 'input', 3, 3,
     'Leak survey every six months; sequencer on the compressor bank.', 'monitored', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '175 days', now() - interval '60 days'),

    ('e1a50001-0000-4000-8000-000000000008', v_tenant_id, 'Packaging line', 'Cardboard and shrink-wrap waste',
     'Landfill contribution; lost material value',
     'operation', 'normal', 'output', 2, 4,
     'Baler on site; cardboard sold to a recycler.', 'controlled', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '170 days', now() - interval '70 days'),

    ('e1a50001-0000-4000-8000-000000000009', v_tenant_id, 'Forklift fleet (LPG)', 'Tailpipe emissions in the warehouse',
     'Indoor air quality; greenhouse-gas contribution',
     'operation', 'normal', 'output', 3, 3,
     'Annual emissions check; transition plan to electric units.', 'monitored', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '165 days', now() - interval '55 days'),

    ('e1a50001-0000-4000-8000-000000000010', v_tenant_id, 'Refrigeration plant', 'Refrigerant leakage (HFC)',
     'High global-warming-potential release',
     'operation', 'abnormal', 'output', 5, 2,
     'Leak-rate tracking per §608; certified technicians only.', 'controlled', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '160 days', now() - interval '40 days'),

    ('e1a50001-0000-4000-8000-000000000011', v_tenant_id, 'Raw material delivery', 'Diesel truck movements',
     'Local air quality; greenhouse-gas contribution',
     'transport', 'normal', 'output', 2, 5,
     'Delivery consolidation; no-idling policy posted at the dock.', 'monitored', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '155 days', now() - interval '80 days'),

    ('e1a50001-0000-4000-8000-000000000012', v_tenant_id, 'Site landscaping', 'Irrigation water use',
     'Potable water depletion in a drought-designated basin',
     'operation', 'normal', 'input', 2, 3,
     'Drip conversion complete; moisture-sensor controller.', 'controlled', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '150 days', now() - interval '100 days'),

    ('e1a50001-0000-4000-8000-000000000013', v_tenant_id, 'End-of-life equipment disposal', 'Electronic waste',
     'Heavy metals to landfill if mishandled',
     'end_of_life', 'normal', 'output', 3, 2,
     'Certified e-waste vendor with a chain-of-custody certificate.', 'controlled', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '145 days', now() - interval '110 days'),

    ('e1a50001-0000-4000-8000-000000000014', v_tenant_id, 'Emergency generator testing', 'Diesel exhaust during monthly test',
     'Short-duration air emissions',
     'operation', 'abnormal', 'output', 2, 4,
     'Tests limited to permitted hours; hour meter logged.', 'monitored', null,
     v_owner_id, v_owner_id, v_owner_id, now() - interval '140 days', now() - interval '35 days')
  on conflict (id) do nothing;
  get diagnostics v_aspect_count = row_count;

  -- ─── 2. Objectives + readings (clauses 6.2.1, 9.1.1) ──────────────
  -- Every objective carries a measurable target AND a target date AND a
  -- link to a significant aspect, so 6.2.1 reads conforming. Monitoring
  -- is where the gap is: o_energy is in_progress with no recent reading.
  insert into public.environmental_objectives (
    id, tenant_id, title, description, related_aspect_id,
    indicator, unit, baseline_value, baseline_label, target_value, target_date,
    improvement_direction, owner_user_id, status, evaluation_method,
    created_by, updated_by, created_at, updated_at
  ) values
    (o_stack, v_tenant_id, 'Cut boiler NOx by 15%',
     'Reduce NOx emissions against the 2025 permit baseline through burner tuning and load shifting.',
     a_stack, 'NOx emissions', 'lb/month', 420, '2025 monthly average', 357,
     (current_date + interval '120 days')::date, 'decrease', v_owner_id, 'in_progress',
     'Monthly stack monitoring report reconciled to the permit log.',
     v_owner_id, v_owner_id, now() - interval '200 days', now() - interval '10 days'),

    (o_voc, v_tenant_id, 'Halve solvent VOC emissions',
     'Substitute the two highest-VOC cleaning solvents and enclose the remaining open stations.',
     a_voc, 'VOC released', 'kg/month', 88, '2025 monthly average', 44,
     (current_date + interval '60 days')::date, 'decrease', v_owner_id, 'in_progress',
     'Solvent purchase records less returned volume, monthly.',
     v_owner_id, v_owner_id, now() - interval '195 days', now() - interval '9 days'),

    (o_water, v_tenant_id, 'Hold discharge oil & grease under permit',
     'Keep monthly composite oil and grease below 80% of the POTW permit limit.',
     a_water, 'Oil & grease', 'mg/L', 76, '2025 monthly average', 40,
     (current_date + interval '200 days')::date, 'decrease', v_owner_id, 'achieved',
     'Monthly composite sample analysed by the contract lab.',
     v_owner_id, v_owner_id, now() - interval '190 days', now() - interval '20 days'),

    (o_waste, v_tenant_id, 'Reduce hazardous waste generated by 20%',
     'Cut ignitable waste volume through solvent recovery and better batch sizing.',
     a_hazwst, 'Hazardous waste shipped', 'kg/quarter', 1250, '2025 quarterly average', 1000,
     (current_date + interval '150 days')::date, 'decrease', v_owner_id, 'in_progress',
     'Manifest totals per quarter.',
     v_owner_id, v_owner_id, now() - interval '185 days', now() - interval '15 days'),

    -- No reading inside the 90-day monitoring window → 9.1.1 attention.
    (o_energy, v_tenant_id, 'Cut compressed-air electricity by 10%',
     'Close leaks and sequence the compressor bank to shed off-peak load.',
     a_stack, 'Electricity for air system', 'MWh/month', 61, '2025 monthly average', 55,
     (current_date + interval '240 days')::date, 'decrease', v_owner_id, 'in_progress',
     'Sub-meter read monthly against the utility bill.',
     v_owner_id, v_owner_id, now() - interval '180 days', now() - interval '120 days'),

    (o_recycle, v_tenant_id, 'Raise packaging diversion to 90%',
     'Increase the share of cardboard and film diverted from landfill.',
     a_hazwst, 'Diversion rate', '%', 71, '2025 average', 90,
     (current_date - interval '30 days')::date, 'increase', v_owner_id, 'missed',
     'Recycler weight tickets over total waste tonnage.',
     v_owner_id, v_owner_id, now() - interval '175 days', now() - interval '30 days')
  on conflict (id) do nothing;
  get diagnostics v_objective_count = row_count;

  insert into public.environmental_objective_readings (
    id, tenant_id, objective_id, reading_date, value, note, recorded_by, created_at
  ) values
    ('e1d80001-0000-4000-8000-000000000001', v_tenant_id, o_stack,
     (current_date - interval '75 days')::date, 402, 'Post tune-up, first full month.', v_owner_id, now() - interval '75 days'),
    ('e1d80001-0000-4000-8000-000000000002', v_tenant_id, o_stack,
     (current_date - interval '44 days')::date, 388, 'Load shifted off the peak window.', v_owner_id, now() - interval '44 days'),
    ('e1d80001-0000-4000-8000-000000000003', v_tenant_id, o_stack,
     (current_date - interval '13 days')::date, 371, 'Trending toward target.', v_owner_id, now() - interval '13 days'),
    ('e1d80001-0000-4000-8000-000000000004', v_tenant_id, o_voc,
     (current_date - interval '70 days')::date, 79, 'First substituted solvent in service.', v_owner_id, now() - interval '70 days'),
    ('e1d80001-0000-4000-8000-000000000005', v_tenant_id, o_voc,
     (current_date - interval '38 days')::date, 66, 'Second station enclosed.', v_owner_id, now() - interval '38 days'),
    ('e1d80001-0000-4000-8000-000000000006', v_tenant_id, o_voc,
     (current_date - interval '8 days')::date, 58, 'On track but behind plan.', v_owner_id, now() - interval '8 days'),
    ('e1d80001-0000-4000-8000-000000000007', v_tenant_id, o_water,
     (current_date - interval '52 days')::date, 44, 'Separator serviced.', v_owner_id, now() - interval '52 days'),
    ('e1d80001-0000-4000-8000-000000000008', v_tenant_id, o_water,
     (current_date - interval '21 days')::date, 38, 'Target met two months running.', v_owner_id, now() - interval '21 days'),
    ('e1d80001-0000-4000-8000-000000000009', v_tenant_id, o_waste,
     (current_date - interval '60 days')::date, 1180, 'Solvent recovery still commissioning.', v_owner_id, now() - interval '60 days'),
    ('e1d80001-0000-4000-8000-000000000010', v_tenant_id, o_waste,
     (current_date - interval '15 days')::date, 1105, 'Batch sizing revised.', v_owner_id, now() - interval '15 days'),
    ('e1d80001-0000-4000-8000-000000000011', v_tenant_id, o_recycle,
     (current_date - interval '40 days')::date, 78, 'Film stream still contaminated.', v_owner_id, now() - interval '40 days'),
    -- o_energy has ONE reading, deliberately older than the 90-day
    -- monitoring window, so the clause reads "no reading in 90 days"
    -- rather than "never monitored".
    ('e1d80001-0000-4000-8000-000000000012', v_tenant_id, o_energy,
     (current_date - interval '128 days')::date, 60, 'Baseline confirmed; sub-meter installed.', v_owner_id, now() - interval '128 days')
  on conflict (id) do nothing;
  get diagnostics v_reading_count = row_count;

  -- ─── 3. Management review (clause 9.3) ────────────────────────────
  -- Four months old, completed, WITH conclusions and decisions — so
  -- reviewHasOutputs() is true and the clause reads conforming.
  insert into public.management_reviews (
    id, tenant_id, title, review_date, period_start, period_end,
    attendees, inputs_summary, conclusions, decisions, status, chaired_by,
    created_by, updated_by, created_at, updated_at
  ) values
    ('e1e90001-0000-4000-8000-000000000001', v_tenant_id,
     'EMS management review — H2 2025',
     (current_date - interval '120 days')::date,
     (current_date - interval '300 days')::date,
     (current_date - interval '125 days')::date,
     'Plant Manager (chair), EHS Manager, Maintenance Lead, Operations Supervisor, Quality Manager',
     E'Reviewed all §9.3.2 inputs: prior-review actions (3 of 4 closed), no change to the compliance obligations register beyond the renewed AQMD permit, significant aspects re-confirmed with one addition (bulk diesel storage), objective progress at mid-cycle, 9 nonconformities raised with 4 closed, monthly monitoring results for stack and discharge, and no external interested-party complaints in the period.',
     E'The EMS remains suitable and adequate for the site''s scale and aspects. Effectiveness is improving but is not yet demonstrated for the newly identified bulk-diesel aspect, which has no operational control documented. Monitoring discipline on the energy objective has slipped.',
     E'1. Assign an owner and document operational control for the bulk diesel storage aspect before the next review.\n2. Fund the solvent-recovery still to hold the hazardous-waste objective.\n3. Restore monthly sub-meter readings for the compressed-air objective.\n4. Schedule the internal audit round once the audit programme is available.',
     'completed', v_owner_id, v_owner_id, v_owner_id,
     now() - interval '120 days', now() - interval '118 days')
  on conflict (id) do nothing;
  get diagnostics v_review_count = row_count;

  -- ─── 4. Nonconformities + CAPA (clause 10.2) ──────────────────────
  -- Nine findings. Exactly ONE open major — that single row is what
  -- forces the report card's headline to "Not ready".
  insert into public.nonconformities (
    id, tenant_id, title, description, source_type, source_reference,
    classification, clause_ref, related_aspect_id, related_objective_id,
    identified_at, identified_by, owner_user_id, status,
    created_by, updated_by, created_at, updated_at
  ) values
    (nc_major, v_tenant_id,
     'Bulk diesel storage has no documented operational control',
     'The 2,000 gal day tank was added to the aspects register as significant, but no operational control, inspection routine, or spill-response provision has been documented for it.',
     'management_review', 'EMS management review — H2 2025', 'major', '8.1',
     a_diesel, null, (current_date - interval '110 days')::date, v_owner_id, v_owner_id, 'open',
     v_owner_id, v_owner_id, now() - interval '110 days', now() - interval '110 days'),

    ('e1c70001-0000-4000-8000-000000000002', v_tenant_id,
     'Secondary containment inspection missed for two consecutive weeks',
     'Weekly container inspections for the hazardous waste accumulation area were not recorded for two weeks in the last quarter.',
     'inspection', 'Hazardous waste area — Drum Yard', 'minor', '8.1',
     a_hazwst, null, (current_date - interval '95 days')::date, v_owner_id, v_owner_id, 'closed',
     v_owner_id, v_owner_id, now() - interval '95 days', now() - interval '40 days'),

    ('e1c70001-0000-4000-8000-000000000003', v_tenant_id,
     'Solvent drums left open between transfers',
     'Two 55-gal solvent drums were observed without lids in the cleaning bay, contrary to the VOC control described in the aspects register.',
     'inspection', 'Parts cleaning bay', 'minor', '8.1',
     a_voc, o_voc, (current_date - interval '88 days')::date, v_owner_id, v_owner_id, 'closed',
     v_owner_id, v_owner_id, now() - interval '88 days', now() - interval '35 days'),

    ('e1c70001-0000-4000-8000-000000000004', v_tenant_id,
     'Compressed-air sub-meter readings not recorded since Q3',
     'The energy objective requires a monthly sub-meter reading; the last recorded reading is over four months old.',
     'management_review', 'EMS management review — H2 2025', 'minor', '9.1.1',
     null, o_energy, (current_date - interval '80 days')::date, v_owner_id, v_owner_id, 'in_progress',
     v_owner_id, v_owner_id, now() - interval '80 days', now() - interval '20 days'),

    ('e1c70001-0000-4000-8000-000000000005', v_tenant_id,
     'Packaging diversion target missed for the year',
     'Diversion finished the year at 78% against a 90% target, driven by film-stream contamination.',
     'management_review', 'EMS management review — H2 2025', 'observation', '6.2',
     null, o_recycle, (current_date - interval '75 days')::date, v_owner_id, v_owner_id, 'in_progress',
     v_owner_id, v_owner_id, now() - interval '75 days', now() - interval '18 days'),

    ('e1c70001-0000-4000-8000-000000000006', v_tenant_id,
     'Stormwater annual report submitted four days late',
     'The annual stormwater report was filed after the permit deadline; the regulator accepted it without penalty.',
     'compliance', 'Permit SW-8812', 'minor', '9.1.2',
     null, null, (current_date - interval '150 days')::date, v_owner_id, v_owner_id, 'closed',
     v_owner_id, v_owner_id, now() - interval '150 days', now() - interval '96 days'),

    ('e1c70001-0000-4000-8000-000000000007', v_tenant_id,
     'Refrigerant leak-rate log incomplete for one unit',
     'Chiller 2 has no leak-rate calculation recorded for the second quarter as §608 requires.',
     'compliance', 'Chiller 2', 'minor', '9.1.2',
     null, null, (current_date - interval '140 days')::date, v_owner_id, v_owner_id, 'closed',
     v_owner_id, v_owner_id, now() - interval '140 days', now() - interval '86 days'),

    ('e1c70001-0000-4000-8000-000000000008', v_tenant_id,
     'Contractor unaware of the site environmental policy',
     'A contract welder could not describe spill-reporting expectations during a site walk.',
     'environmental_aspect', 'Contractor induction', 'observation', '7.3',
     null, null, (current_date - interval '55 days')::date, v_owner_id, v_owner_id, 'closed',
     v_owner_id, v_owner_id, now() - interval '55 days', now() - interval '25 days'),

    ('e1c70001-0000-4000-8000-000000000009', v_tenant_id,
     'Waste manifest copies filed without the signed return',
     'Three manifests were filed before the designated-facility signed copy came back.',
     'inspection', 'Waste records binder', 'minor', '7.5',
     a_hazwst, null, (current_date - interval '48 days')::date, v_owner_id, v_owner_id, 'open',
     v_owner_id, v_owner_id, now() - interval '48 days', now() - interval '48 days')
  on conflict (id) do nothing;
  get diagnostics v_nc_count = row_count;

  -- Actions. Two are deliberately overdue and still open (→ 10.2
  -- attention); the verified ones evidence continual improvement (10.3).
  insert into public.nonconformity_actions (
    id, tenant_id, nonconformity_id, description, action_type,
    assigned_to_user_id, due_at, completed_at, completed_by_user_id,
    verified_effective_at, verified_by_user_id, verification_notes,
    status, created_by_user_id, created_at, updated_at
  ) values
    (
      'e1f00001-0000-4000-8000-000000000001', v_tenant_id, nc_major,
      'Write and issue an operational control procedure for the bulk diesel day tank, including weekly visual inspection and spill-response provisions.',
      'corrective', v_owner_id, (current_date - interval '20 days')::date,
      null, null, null, null, null, 'in_progress', v_owner_id,
      now() - interval '108 days', now() - interval '20 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000002', v_tenant_id, nc_major,
      'Add the day tank to the weekly containment inspection route.',
      'correction', v_owner_id, (current_date - interval '5 days')::date,
      null, null, null, null, null, 'open', v_owner_id,
      now() - interval '108 days', now() - interval '108 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000003', v_tenant_id, 'e1c70001-0000-4000-8000-000000000002',
      'Move the weekly container inspection onto the scheduled task list with an escalation if not completed by Friday.',
      'corrective', v_owner_id, (current_date - interval '60 days')::date,
      now() - interval '58 days', v_owner_id,
      case when v_can_verify then now() - interval '40 days' else null end,
      case when v_can_verify then v_member_id else null end,
      case when v_can_verify then 'Four consecutive weeks recorded on time since the change.' else null end,
      case when v_can_verify then 'verified' else 'completed' end, v_owner_id,
      now() - interval '94 days', now() - interval '40 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000004', v_tenant_id, 'e1c70001-0000-4000-8000-000000000003',
      'Fit self-closing lids to both solvent drums and re-brief the cleaning-bay crew.',
      'corrective', v_owner_id, (current_date - interval '55 days')::date,
      now() - interval '54 days', v_owner_id,
      case when v_can_verify then now() - interval '34 days' else null end,
      case when v_can_verify then v_member_id else null end,
      case when v_can_verify then 'Two follow-up walks found all drums closed.' else null end,
      case when v_can_verify then 'verified' else 'completed' end, v_owner_id,
      now() - interval '87 days', now() - interval '34 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000005', v_tenant_id, 'e1c70001-0000-4000-8000-000000000006',
      'Add the stormwater annual report to the compliance calendar with a 30-day advance reminder.',
      'preventive', v_owner_id, (current_date - interval '120 days')::date,
      now() - interval '118 days', v_owner_id,
      case when v_can_verify then now() - interval '96 days' else null end,
      case when v_can_verify then v_member_id else null end,
      case when v_can_verify then 'Obligation now on the calendar; next occurrence reminded on schedule.' else null end,
      case when v_can_verify then 'verified' else 'completed' end, v_owner_id,
      now() - interval '149 days', now() - interval '96 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000006', v_tenant_id, 'e1c70001-0000-4000-8000-000000000007',
      'Reconstruct the Q2 leak-rate calculation and add the chiller to the quarterly §608 checklist.',
      'corrective', v_owner_id, (current_date - interval '110 days')::date,
      now() - interval '108 days', v_owner_id,
      case when v_can_verify then now() - interval '86 days' else null end,
      case when v_can_verify then v_member_id else null end,
      case when v_can_verify then 'Q3 and Q4 calculations both complete and on file.' else null end,
      case when v_can_verify then 'verified' else 'completed' end, v_owner_id,
      now() - interval '139 days', now() - interval '86 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000007', v_tenant_id, 'e1c70001-0000-4000-8000-000000000008',
      'Add environmental policy and spill reporting to the contractor induction pack and re-induct active contractors.',
      'corrective', v_owner_id, (current_date - interval '30 days')::date,
      now() - interval '28 days', v_owner_id,
      case when v_can_verify then now() - interval '25 days' else null end,
      case when v_can_verify then v_member_id else null end,
      case when v_can_verify then 'Spot-check of three contractors confirmed awareness.' else null end,
      case when v_can_verify then 'verified' else 'completed' end, v_owner_id,
      now() - interval '54 days', now() - interval '25 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000008', v_tenant_id, 'e1c70001-0000-4000-8000-000000000004',
      'Restore the monthly compressed-air sub-meter reading and back-fill the missing months from utility data.',
      'corrective', v_owner_id, (current_date - interval '10 days')::date,
      null, null, null, null, null, 'in_progress', v_owner_id,
      now() - interval '79 days', now() - interval '10 days'
    ),
    (
      'e1f00001-0000-4000-8000-000000000009', v_tenant_id, 'e1c70001-0000-4000-8000-000000000009',
      'Hold manifests in a pending tray until the designated-facility copy returns, then file as a set.',
      'corrective', v_owner_id, (current_date + interval '14 days')::date,
      null, null, null, null, null, 'open', v_owner_id,
      now() - interval '47 days', now() - interval '47 days'
    )
  on conflict (id) do nothing;
  get diagnostics v_action_count = row_count;

  -- ─── 5. Compliance obligations (clauses 6.1.3, 9.1.2) ─────────────
  -- Six obligations, one already past due → 6.1.3 attention. The
  -- completed event below is what 9.1.2 reads as "compliance evaluated".
  insert into public.compliance_calendar_obligations (
    id, tenant_id, title, description, regulatory_ref, category,
    cadence, next_due_at, owner_user_id, site_label, status, source,
    created_by, created_at, updated_at
  ) values
    ('e2000001-0000-4000-8000-000000000001', v_tenant_id,
     'AQMD permit-to-operate renewal', 'Annual renewal for the boiler stack permit.',
     'AQMD Rule 2291', 'air', 'annual', (current_date + interval '95 days')::date,
     v_owner_id, 'Main plant', 'open', 'tenant', v_owner_id,
     now() - interval '200 days', now() - interval '200 days'),
    ('e2000001-0000-4000-8000-000000000002', v_tenant_id,
     'POTW discharge monitoring report', 'Monthly composite sample and report to the treatment works.',
     'Permit POTW-4471', 'water', 'monthly', (current_date + interval '12 days')::date,
     v_owner_id, 'Main plant', 'open', 'tenant', v_owner_id,
     now() - interval '200 days', now() - interval '12 days'),
    -- Overdue on purpose.
    ('e2000001-0000-4000-8000-000000000003', v_tenant_id,
     'Stormwater annual report', 'Annual report of site stormwater monitoring results.',
     'Permit SW-8812', 'water', 'annual', (current_date - interval '9 days')::date,
     v_owner_id, 'Main plant', 'open', 'tenant', v_owner_id,
     now() - interval '190 days', now() - interval '190 days'),
    ('e2000001-0000-4000-8000-000000000004', v_tenant_id,
     'Hazardous waste biennial report', 'Federal biennial hazardous waste generator report.',
     '40 CFR 262.41', 'waste', 'biennial', (current_date + interval '210 days')::date,
     v_owner_id, 'Main plant', 'open', 'tenant', v_owner_id,
     now() - interval '185 days', now() - interval '185 days'),
    ('e2000001-0000-4000-8000-000000000005', v_tenant_id,
     'SPCC plan review', 'Five-year review of the Spill Prevention, Control and Countermeasure plan.',
     '40 CFR 112.5', 'spill', 'quinquennial', (current_date + interval '330 days')::date,
     v_owner_id, 'Main plant', 'open', 'tenant', v_owner_id,
     now() - interval '180 days', now() - interval '180 days'),
    ('e2000001-0000-4000-8000-000000000006', v_tenant_id,
     'Refrigerant leak-rate calculation', 'Quarterly §608 leak-rate calculation for each appliance over 50 lb.',
     '40 CFR 82 subpart F', 'air', 'quarterly', (current_date + interval '40 days')::date,
     v_owner_id, 'Main plant', 'open', 'tenant', v_owner_id,
     now() - interval '175 days', now() - interval '50 days')
  on conflict (id) do nothing;
  get diagnostics v_oblig_count = row_count;

  insert into public.compliance_calendar_events (
    id, tenant_id, obligation_id, occurrence_at, completed_at, completed_by, note, created_at
  ) values
    ('e2100001-0000-4000-8000-000000000001', v_tenant_id, 'e2000001-0000-4000-8000-000000000002',
     (current_date - interval '18 days')::date, now() - interval '18 days', v_owner_id,
     'Composite sample submitted; oil and grease 38 mg/L, within permit.', now() - interval '18 days'),
    ('e2100001-0000-4000-8000-000000000002', v_tenant_id, 'e2000001-0000-4000-8000-000000000006',
     (current_date - interval '50 days')::date, now() - interval '50 days', v_owner_id,
     'Q4 leak-rate calculations complete for all four appliances.', now() - interval '50 days')
  on conflict (id) do nothing;
  get diagnostics v_event_count = row_count;

  -- ─── 6. Clause evidence pins ──────────────────────────────────────
  -- Hand-curated pins so /admin/evidence/iso14001 is not empty on a demo.
  -- source_id is text by design (source rows use both uuids and codes).
  insert into public.iso14001_clause_evidence (
    id, tenant_id, clause_code, source_table, source_id,
    captured_at, captured_by_user_id, notes, created_at
  ) values
    ('e2200001-0000-4000-8000-000000000001', v_tenant_id, '6.1.2', 'environmental_aspects', a_stack::text,
     now() - interval '30 days', v_owner_id, 'Highest-scoring significant aspect; permit-linked.', now() - interval '30 days'),
    ('e2200001-0000-4000-8000-000000000002', v_tenant_id, '6.1.2', 'environmental_aspects', a_hazwst::text,
     now() - interval '30 days', v_owner_id, 'Drives the RCRA accumulation controls.', now() - interval '30 days'),
    ('e2200001-0000-4000-8000-000000000003', v_tenant_id, '6.1.3', 'compliance_calendar_obligations', 'e2000001-0000-4000-8000-000000000001',
     now() - interval '28 days', v_owner_id, 'Primary air permit obligation.', now() - interval '28 days'),
    ('e2200001-0000-4000-8000-000000000004', v_tenant_id, '6.2.1', 'environmental_objectives', o_stack::text,
     now() - interval '26 days', v_owner_id, 'NOx reduction objective with monthly monitoring.', now() - interval '26 days'),
    ('e2200001-0000-4000-8000-000000000005', v_tenant_id, '9.1.1', 'environmental_objective_readings', 'e1d80001-0000-4000-8000-000000000003',
     now() - interval '12 days', v_owner_id, 'Most recent stack reading.', now() - interval '12 days'),
    ('e2200001-0000-4000-8000-000000000006', v_tenant_id, '9.3', 'management_reviews', 'e1e90001-0000-4000-8000-000000000001',
     now() - interval '115 days', v_owner_id, 'H2 2025 review with recorded outputs.', now() - interval '115 days'),
    ('e2200001-0000-4000-8000-000000000007', v_tenant_id, '10.2', 'nonconformities', nc_major::text,
     now() - interval '105 days', v_owner_id, 'Open major — blocks certification readiness.', now() - interval '105 days'),
    ('e2200001-0000-4000-8000-000000000008', v_tenant_id, '10.2', 'nonconformity_actions', 'e1f00001-0000-4000-8000-000000000003',
     now() - interval '38 days', v_owner_id, 'Verified corrective action with effectiveness check.', now() - interval '38 days'),
    ('e2200001-0000-4000-8000-000000000009', v_tenant_id, '9.1.2', 'compliance_calendar_obligations', 'e2000001-0000-4000-8000-000000000006',
     now() - interval '48 days', v_owner_id, 'Quarterly §608 evaluation.', now() - interval '48 days'),
    ('e2200001-0000-4000-8000-000000000010', v_tenant_id, '10.3', 'environmental_objectives', o_water::text,
     now() - interval '19 days', v_owner_id, 'Objective achieved — evidence of improvement.', now() - interval '19 days')
  on conflict (tenant_id, clause_code, source_table, source_id) do nothing;
  get diagnostics v_pin_count = row_count;

  return format(
    'Seeded WLS Demo ISO 14001: aspects=%s objectives=%s readings=%s reviews=%s nonconformities=%s actions=%s obligations=%s events=%s pins=%s%s',
    v_aspect_count, v_objective_count, v_reading_count, v_review_count,
    v_nc_count, v_action_count, v_oblig_count, v_event_count, v_pin_count,
    case when v_can_verify then '' else ' (single-member tenant — CAPA left unverified)' end
  );
end $$;

revoke execute on function public.seed_wls_iso14001_demo() from anon, authenticated, public;

do $$ begin raise notice '%', public.seed_wls_iso14001_demo(); end $$;

notify pgrst, 'reload schema';

commit;
