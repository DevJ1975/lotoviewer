-- Demo seed — populates the incident module for a client walkthrough.
--
-- Creates a realistic mix of incidents on the demo tenant so the
-- sales / training environment shows a populated scorecard, an
-- open investigation, completed CAPAs with a hierarchy mix, an
-- active care case, an anonymous QR-reported near-miss, an
-- environmental spill triggering the EPA RQ banner, a published
-- lesson-learned, and OSHA 300/300A entries with mixed
-- classifications.
--
-- Idempotent — every insert is gated on a deterministic
-- report_number / token / id check. Re-running is safe; nothing
-- piles up.
--
-- This is NOT a numbered migration — manual run-once-per-tenant
-- seed. Don't run in production.
--
-- Prereqs:
--   • Migrations 001–068 applied
--   • At least one tenant flagged is_demo=true (the seed picks the
--     oldest demo tenant when more than one exists)
--   • At least one profile/auth user (we need a "reporter" + a
--     "lead investigator" on the demo tenant)

do $$
declare
  v_tenant_id           uuid;
  v_owner_id            uuid;
  v_admin_id            uuid;
  v_member_id           uuid;
  v_establishment_id    uuid;

  -- Incident UUIDs are stable so the seed is idempotent and
  -- subsequent updates (RCA nodes, CAPA, care, etc.) can deterministically
  -- reference them.
  v_inc_injury_id       uuid := '11111111-aaaa-bbbb-cccc-000000000001';
  v_inc_near_miss_id    uuid := '11111111-aaaa-bbbb-cccc-000000000002';
  v_inc_property_id     uuid := '11111111-aaaa-bbbb-cccc-000000000003';
  v_inc_environmental_id uuid := '11111111-aaaa-bbbb-cccc-000000000004';
  v_inc_anon_id         uuid := '11111111-aaaa-bbbb-cccc-000000000005';
  v_inc_closed_id       uuid := '11111111-aaaa-bbbb-cccc-000000000006';
  v_inc_repeat_id       uuid := '11111111-aaaa-bbbb-cccc-000000000007';

  v_qr_token_id         uuid := '11111111-aaaa-bbbb-dddd-000000000001';
  v_qr_token_hex        text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  v_investigation_id    uuid := '11111111-aaaa-bbbb-eeee-000000000001';
  v_inv_closed_id       uuid := '11111111-aaaa-bbbb-eeee-000000000002';

  v_care_id             uuid := '11111111-aaaa-bbbb-ffff-000000000001';
  v_person_injured_id   uuid := '11111111-aaaa-cccc-ffff-000000000001';

  v_action_done_id      uuid := '11111111-bbbb-cccc-ffff-000000000001';
  v_action_open_id      uuid := '11111111-bbbb-cccc-ffff-000000000002';
  v_action_ppe_id       uuid := '11111111-bbbb-cccc-ffff-000000000003';

  v_summary             jsonb;
begin
  -- ── Resolve the demo tenant ──────────────────────────────────────────
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    raise notice '[seed_incidents_demo] No is_demo=true tenant found — flag a tenant as demo before re-running.';
    return;
  end if;

  -- ── Resolve a few users on this tenant ───────────────────────────────
  -- Owner first (preferred reporter for the demo); fall back to any
  -- member.
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
    raise notice '[seed_incidents_demo] No tenant_memberships row for the demo tenant — onboard at least one user before re-running.';
    return;
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
      jsonb_build_object(
        extract(year from now())::text, jsonb_build_object('employees', 47, 'hours', 96720)
      ),
      'Pat Owens', 'VP Operations',
      v_owner_id, v_owner_id
    ) returning id into v_establishment_id;
    raise notice '[seed_incidents_demo] Created establishment %', v_establishment_id;
  end if;

  -- ── Seed default notification rules (idempotent helper from 066) ─────
  perform public.seed_incident_notification_defaults(v_tenant_id);

  -- ── Anonymous-intake QR token ────────────────────────────────────────
  insert into public.incident_anon_intake_tokens
    (id, tenant_id, label, token, rate_limit_per_hour, total_reports, created_by, updated_by)
    values
    (v_qr_token_id, v_tenant_id, 'Loading Dock B (demo)', v_qr_token_hex, 30, 1,
     v_owner_id, v_owner_id)
    on conflict (id) do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- Incidents
  -- ────────────────────────────────────────────────────────────────────

  -- 1. RECORDABLE injury (lost-time, 5 days away). The headline case
  --    for the scorecard. Becomes recordable=true after the
  --    classification + 300 log entry below.
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

  -- 2. NEAR-MISS (good catch — captured for leading indicator).
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

  -- 3. PROPERTY damage (forklift hit racking). Non-recordable.
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

  -- 4. ENVIRONMENTAL spill — chlorine 25 lb. Triggers EPA RQ banner
  --    (RQ for chlorine = 10 lb).
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

  -- 5. ANONYMOUS QR-code report (uses the seed's QR token).
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

  -- 6. CLOSED injury (3 months ago, recordable, RCA published as a
  --    lesson). Drives the scorecard's "days since last recordable",
  --    rcaCompletionPct, and the lessons-learned library.
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

  -- 7. REPEAT incident — same location + similar description as #1
  --    so the repeat-incident banner has something to surface.
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
  -- Injured person + classification + care for the lost-time injury (#1)
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

  -- Care case. status='modified_duty' REQUIRES return_to_work_at IS NULL
  -- per migration 064's check constraint (modified-duty workers haven't
  -- "fully" returned yet — RTW means full duty). The demo's intent is a
  -- worker still on modified duty 7 days in.
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

  -- 300 log entry (cached row that the certify flow reads).
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
  -- Investigation + RCA (5 Whys) + CAPAs for #1
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_investigations (
    id, tenant_id, incident_id, rca_method,
    began_at, target_close_at,
    lead_investigator, team_member_ids,
    scope_summary, sequence_of_events,
    immediate_causes, underlying_causes, root_causes,
    created_by, updated_by
  ) values (
    v_investigation_id, v_tenant_id, v_inc_injury_id, '5_whys',
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
    (v_tenant_id, v_investigation_id, 1, 'What happened?',                    'Riley slipped on hydraulic fluid and sprained their knee.', false),
    (v_tenant_id, v_investigation_id, 2, 'Why was there hydraulic fluid?',    'Forklift hose was leaking.',                                false),
    (v_tenant_id, v_investigation_id, 3, 'Why was the hose leaking?',         'It was past its scheduled replacement date.',               false),
    (v_tenant_id, v_investigation_id, 4, 'Why was the replacement missed?',   'PM schedule was tracked manually and the date drifted.',    false),
    (v_tenant_id, v_investigation_id, 5, 'Why was the PM schedule manual?',   'No automated PM trigger on hydraulic-system components.',   true)
  on conflict do nothing;

  -- CAPAs — three actions covering the hierarchy of controls.
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
  -- Closed investigation on #6 — published as a lesson learned.
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
  -- Notification log: a couple of "alert sent" rows so the per-incident
  -- Notifications card has something to render. status='sent' even
  -- though the demo Resend may be skipped — better demo UX than empty.
  -- ────────────────────────────────────────────────────────────────────

  insert into public.incident_notifications (
    tenant_id, incident_id, trigger_type, channel,
    recipient_user_id, recipient_email, status
  ) values
    (v_tenant_id, v_inc_injury_id, 'initial', 'email', v_admin_id, 'admin@demo.example', 'sent'),
    (v_tenant_id, v_inc_injury_id, 'escalation', 'email', v_owner_id, 'owner@demo.example', 'sent'),
    (v_tenant_id, v_inc_environmental_id, 'initial', 'email', v_admin_id, 'admin@demo.example', 'sent'),
    (v_tenant_id, v_inc_anon_id, 'initial', 'email', v_admin_id, 'admin@demo.example', 'sent')
  on conflict do nothing;

  -- ────────────────────────────────────────────────────────────────────
  -- Pre-built 300A annual summary (uncertified). Lets the OSHA page
  -- render with values without requiring the operator to recompute
  -- before the certify button is offered.
  -- ────────────────────────────────────────────────────────────────────

  v_summary := jsonb_build_object(
    'year', extract(year from now())::int,
    'total_deaths', 0,
    'total_days_away', 1,
    'total_restricted', 0,
    'total_other_recordable', 1,
    'total_days_away_count', 5,
    'total_days_restricted_count', 0,
    'by_injury_type', jsonb_build_object(
      'injury', 2, 'skin_disorder', 0, 'respiratory', 0,
      'poisoning', 0, 'hearing_loss', 0, 'other_illness', 0
    ),
    'total_hours_worked', 96720,
    'annual_avg_employees', 47
  );

  insert into public.osha_annual_summaries (
    tenant_id, establishment_id, year,
    totals_json, total_hours_worked, annual_avg_employees
  ) values (
    v_tenant_id, v_establishment_id, extract(year from now())::int,
    v_summary, 96720, 47
  ) on conflict (tenant_id, establishment_id, year) do nothing;

  raise notice '[seed_incidents_demo] Seed complete for tenant %', v_tenant_id;
end $$;
