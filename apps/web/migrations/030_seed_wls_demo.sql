-- Migration 030: WLS Demo (#0002) canonical seed
--
-- Phase D of the multi-tenant rollout. Defines public.seed_wls_demo() —
-- a SECURITY DEFINER function that populates the WLS Demo tenant with
-- believable data across LOTO, Confined Spaces, Hot Work, Training, and
-- Devices.
--
-- Two callers:
--   1. This migration runs the function once on first apply, populating
--      WLS Demo immediately so the dashboard isn't empty.
--   2. /api/superadmin/tenants/0002/reset-demo wipes the tenant then
--      RPCs into this function, restoring a known-good state any time.
--
-- Idempotent: every insert uses ON CONFLICT DO NOTHING keyed on a
-- DEMO- prefixed natural key (or skips when an active permit already
-- exists), so re-running is a no-op once seeded.
--
-- Seed counts (when freshly run):
--   loto_equipment             12
--   loto_energy_steps          24
--   loto_reviews                3
--   loto_confined_spaces        4
--   loto_confined_space_permits 2  (1 active, 1 closed)
--   loto_atmospheric_tests      4
--   loto_hot_work_permits       3  (1 active, 2 closed)
--   loto_training_records       6
--   loto_devices                6
--
-- All photo_url fields are null — Phase D MVP. Photo assets ship in a
-- later PR with copyright-clean images under public/demo/.
--
-- Pre-flight: requires at least one row in public.profiles (used as the
-- "demo supervisor" for permits + atmospheric tests where the FK is
-- NOT NULL). Fails informatively if none exist.

begin;

create or replace function public.seed_wls_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id     uuid;
  v_actor_id      uuid;
  v_now           timestamptz := now();
  v_eq_count      int := 0;
  v_step_count    int := 0;
  v_rev_count     int := 0;
  v_cs_count      int := 0;
  v_csp_count     int := 0;
  v_at_count      int := 0;
  v_hw_count      int := 0;
  v_tr_count      int := 0;
  v_dv_count      int := 0;
  v_active_csp_id uuid;
  v_done_csp_id   uuid;
begin
  -- Resolve the WLS Demo tenant.
  select id into v_tenant_id from public.tenants where slug = 'wls-demo';
  if v_tenant_id is null then
    raise exception 'seed_wls_demo: tenant slug=wls-demo not found — run migration 028 first';
  end if;

  -- Actor for permit FKs that are NOT NULL — prefer a superadmin so the
  -- audit trail makes sense. Required for confined-space permits and
  -- hot work permits (entry_supervisor_id / pai_id NOT NULL).
  select id into v_actor_id
    from public.profiles
   where is_superadmin = true
   order by created_at asc
   limit 1;
  if v_actor_id is null then
    select id into v_actor_id from public.profiles order by created_at asc limit 1;
  end if;
  if v_actor_id is null then
    raise exception 'seed_wls_demo: no profiles found — log in once before seeding';
  end if;

  -- ─── 1. Equipment ───────────────────────────────────────────────────────
  insert into public.loto_equipment
    (equipment_id, tenant_id, description, department, prefix, photo_status,
     has_equip_photo, has_iso_photo, decommissioned, verified)
  values
    -- Packaging (4)
    ('DEMO-PKG-CONV-01', v_tenant_id, 'Conveyor 1 — Packaging line A',                    'Packaging',    'DEMO', 'missing', false, false, false, false),
    ('DEMO-PKG-WRAP-01', v_tenant_id, 'Shrink wrapper — Line A end',                      'Packaging',    'DEMO', 'missing', false, false, false, false),
    ('DEMO-PKG-SEAL-01', v_tenant_id, 'Heat sealer — case packer',                        'Packaging',    'DEMO', 'missing', false, false, false, false),
    ('DEMO-PKG-PALL-01', v_tenant_id, 'Palletizer — robotic, Line A discharge',           'Packaging',    'DEMO', 'missing', false, false, false, false),
    -- Frying (3)
    ('DEMO-FRY-FRY-01',  v_tenant_id, 'Fryer #1 — continuous, 600 lb/hr',                 'Frying',       'DEMO', 'missing', false, false, false, false),
    ('DEMO-FRY-OIL-01',  v_tenant_id, 'Oil circulation pump — Fryer #1 loop',             'Frying',       'DEMO', 'missing', false, false, false, false),
    ('DEMO-FRY-COOL-01', v_tenant_id, 'Cooling tower — west fryer support',               'Frying',       'DEMO', 'missing', false, false, false, false),
    -- Maintenance (3)
    ('DEMO-MNT-COMP-01', v_tenant_id, 'Air compressor #1 — 100 hp rotary screw',          'Maintenance',  'DEMO', 'missing', false, false, false, false),
    ('DEMO-MNT-HVAC-01', v_tenant_id, 'HVAC rooftop unit — admin building',               'Maintenance',  'DEMO', 'missing', false, false, false, false),
    ('DEMO-MNT-BOIL-01', v_tenant_id, 'Boiler — natural gas, 150 PSIG',                   'Maintenance',  'DEMO', 'missing', false, false, false, false),
    -- Distribution (2)
    ('DEMO-DST-FORK-01', v_tenant_id, 'Forklift charger station — bay 3',                 'Distribution', 'DEMO', 'missing', false, false, false, false),
    ('DEMO-DST-DOCK-01', v_tenant_id, 'Loading dock leveler — bay 2',                     'Distribution', 'DEMO', 'missing', false, false, false, false)
  on conflict (equipment_id) do nothing;
  get diagnostics v_eq_count = row_count;

  -- ─── 2. Energy steps (2-3 per equipment, mixed types) ──────────────────
  insert into public.loto_energy_steps
    (equipment_id, tenant_id, energy_type, step_number, tag_description, isolation_procedure)
  select equipment_id, v_tenant_id, energy_type, step_number, tag_description, isolation_procedure
    from (values
      ('DEMO-PKG-CONV-01', 'Electrical', 1, 'Disconnect MCC-A bay 3', 'Open disconnect, verify zero voltage on motor leads, apply lock'),
      ('DEMO-PKG-CONV-01', 'Pneumatic',  2, 'Air line shutoff valve', 'Close ball valve, bleed downstream pressure to 0 PSI'),
      ('DEMO-PKG-WRAP-01', 'Electrical', 1, 'Local disconnect',       'Rotate disconnect to OFF, attempt restart to verify, lock'),
      ('DEMO-PKG-WRAP-01', 'Thermal',    2, 'Heat band power',        'Allow 30-minute cool-down before contact'),
      ('DEMO-PKG-SEAL-01', 'Electrical', 1, 'MCC-A bay 5',            'Open disconnect, verify zero voltage'),
      ('DEMO-PKG-SEAL-01', 'Thermal',    2, 'Sealing bar',            'Wait 20 min for cool-down, verify ≤ 50°C with IR thermometer'),
      ('DEMO-PKG-PALL-01', 'Electrical', 1, 'PDP-3 breaker B12',      'Trip breaker, lock with multi-lock hasp'),
      ('DEMO-PKG-PALL-01', 'Mechanical', 2, 'Robotic arm gravity',    'Lower arm to home position, install mechanical pin'),
      ('DEMO-FRY-FRY-01',  'Thermal',    1, 'Fryer heating element',  'Disable burner control, allow 4 hours minimum cool-down'),
      ('DEMO-FRY-FRY-01',  'Electrical', 2, 'Main disconnect',        'Open disconnect, verify zero voltage on element terminals'),
      ('DEMO-FRY-FRY-01',  'Hydraulic',  3, 'Oil drain valve',        'Close drain valve, lock in closed position'),
      ('DEMO-FRY-OIL-01',  'Electrical', 1, 'Pump motor disconnect',  'Open and lock motor disconnect'),
      ('DEMO-FRY-OIL-01',  'Hydraulic',  2, 'Suction/discharge valves', 'Close both valves, bleed line through sample port'),
      ('DEMO-FRY-COOL-01', 'Electrical', 1, 'Fan motor disconnect',   'Open disconnect at panel, verify zero voltage'),
      ('DEMO-FRY-COOL-01', 'Mechanical', 2, 'Fan blade rotation',     'Apply mechanical brake to fan shaft'),
      ('DEMO-MNT-COMP-01', 'Electrical', 1, 'Main disconnect',        'Open and lock disconnect at MCC-B bay 1'),
      ('DEMO-MNT-COMP-01', 'Pneumatic',  2, 'Receiver tank',          'Close isolation valve, bleed receiver to 0 PSI via drain valve'),
      ('DEMO-MNT-HVAC-01', 'Electrical', 1, 'Rooftop disconnect',     'Open disconnect, verify zero voltage on all phases'),
      ('DEMO-MNT-HVAC-01', 'Pneumatic',  2, 'Refrigerant lines',      'Close service valves at compressor, follow EPA recovery procedure'),
      ('DEMO-MNT-BOIL-01', 'Thermal',    1, 'Burner shutdown',        'Disable burner ignition, allow 8-hour cool-down'),
      ('DEMO-MNT-BOIL-01', 'Hydraulic',  2, 'Steam header valves',    'Close and lock main steam stop valve and equalizer'),
      ('DEMO-MNT-BOIL-01', 'Chemical',   3, 'Gas supply',             'Close and lock natural gas supply valve at meter'),
      ('DEMO-DST-FORK-01', 'Electrical', 1, 'Charger AC supply',      'Unplug AC mains, lock breaker at panel P-DST-1'),
      ('DEMO-DST-DOCK-01', 'Hydraulic',  1, 'Hydraulic power unit',   'Power off HPU, install safety bar in stowed position')
    ) as v(equipment_id, energy_type, step_number, tag_description, isolation_procedure)
   where not exists (
     select 1 from public.loto_energy_steps s
      where s.equipment_id = v.equipment_id
        and s.step_number  = v.step_number
        and s.tenant_id    = v_tenant_id
   );
  get diagnostics v_step_count = row_count;

  -- ─── 3. Reviews (3 departments signed off) ──────────────────────────────
  -- No natural unique key, so use existence-by-department to stay idempotent.
  insert into public.loto_reviews (tenant_id, department, reviewer_name, reviewer_email, signed_at, approved)
  select v_tenant_id, d, 'Demo Reviewer', 'demo@wls.example', v_now - interval '14 days', true
    from (values ('Packaging'), ('Frying'), ('Maintenance')) as t(d)
   where not exists (
     select 1 from public.loto_reviews r
      where r.tenant_id = v_tenant_id and r.department = t.d
   );
  get diagnostics v_rev_count = row_count;

  -- ─── 4. Confined Spaces (4) ─────────────────────────────────────────────
  insert into public.loto_confined_spaces
    (space_id, tenant_id, description, department, classification, space_type,
     entry_dimensions, known_hazards, isolation_required, internal_notes)
  values
    ('DEMO-CS-TANK-01', v_tenant_id,
     'Holding tank A — 1500 gal jacketed, top-loaded', 'Frying',
     'permit_required', 'tank',
     '24-inch top manway',
     array['Engulfment from residual product','Hot oil residue at 180°F+','Limited egress via single top manway'],
     'LOTO on transfer pump and heating element; drain and rinse before entry',
     'Demo space — used for live walkthroughs.'),
    ('DEMO-CS-SILO-01', v_tenant_id,
     'Storage silo #3 — corn kernels, pneumatic fill', 'Frying',
     'permit_required', 'silo',
     'Top hatch 18 inches; rescue tripod required',
     array['Engulfment in kernels','Dust explosion (LEL applies)','O2 deficiency from biological respiration'],
     'LOTO on rotary discharge valve and pneumatic fill; continuous forced-air ventilation',
     null),
    ('DEMO-CS-PIT-01', v_tenant_id,
     'Sump pit — central drain, packaging line A', 'Packaging',
     'permit_required', 'pit',
     '36 × 36 inch grate; vertical drop 6 ft',
     array['H2S from organic matter in CIP returns','Slip hazard from caustic residue','Single-ladder egress'],
     'LOTO on submersible pump; block CIP-2 return with knife valve',
     null),
    ('DEMO-CS-PLEN-01', v_tenant_id,
     'HVAC plenum — admin building above suspended ceiling', 'Maintenance',
     'non_permit', 'plenum',
     'Ceiling-tile access, multiple openings',
     array['Falling debris','Limited lighting'],
     'Verify HVAC fan locked off (DEMO-MNT-HVAC-01) before entry',
     'Reclassified non-permit after 2024 review — no atmospheric hazard.')
  on conflict (space_id) do nothing;
  get diagnostics v_cs_count = row_count;

  -- ─── 5. Confined Space Permits (1 active + 1 closed) + atmospheric tests
  -- Active permit on DEMO-CS-TANK-01, started 1h ago, expires in 7h.
  if not exists (
    select 1 from public.loto_confined_space_permits
     where space_id = 'DEMO-CS-TANK-01'
       and canceled_at is null
       and expires_at > v_now
  ) then
    v_active_csp_id := gen_random_uuid();
    insert into public.loto_confined_space_permits (
      id, tenant_id, space_id, purpose,
      started_at, expires_at,
      entry_supervisor_id, entry_supervisor_signature_at,
      attendants, entrants, hazards_present,
      isolation_measures, rescue_service,
      communication_method, equipment_list, notes
    ) values (
      v_active_csp_id, v_tenant_id, 'DEMO-CS-TANK-01',
      'Inspect and clean residual product from tank bottom',
      v_now - interval '1 hour',
      v_now + interval '7 hours',
      v_actor_id, v_now - interval '1 hour',
      array['Demo Attendant'], array['Demo Entrant 1', 'Demo Entrant 2'],
      array['Hot residue','Engulfment'],
      array['Pumps locked at MCC-A','Tank drained, rinsed, and cooled to 90°F'],
      jsonb_build_object('name','Plant rescue team','phone','+1-555-0100','eta_minutes',5,'equipment',array['SCBA','Tripod']),
      'Two-way radio + visual line-of-sight',
      array['SCBA','Tripod with retrieval line','Calibrated 4-gas meter'],
      'DEMO permit — used for live walkthroughs.'
    );
    v_csp_count := v_csp_count + 1;

    insert into public.loto_atmospheric_tests
      (id, tenant_id, permit_id, tested_at, tested_by, kind,
       o2_pct, lel_pct, h2s_ppm, co_ppm, notes)
    values
      (gen_random_uuid(), v_tenant_id, v_active_csp_id, v_now - interval '55 minutes', v_actor_id, 'pre_entry',
       20.9, 0, 0, 0, 'Pre-entry — pass'),
      (gen_random_uuid(), v_tenant_id, v_active_csp_id, v_now - interval '15 minutes', v_actor_id, 'periodic',
       20.8, 0, 0, 1, 'Periodic — pass');
    v_at_count := v_at_count + 2;
  end if;

  -- Closed permit on DEMO-CS-SILO-01, 3 days ago.
  if not exists (
    select 1 from public.loto_confined_space_permits
     where space_id = 'DEMO-CS-SILO-01' and tenant_id = v_tenant_id
  ) then
    v_done_csp_id := gen_random_uuid();
    insert into public.loto_confined_space_permits (
      id, tenant_id, space_id, purpose,
      started_at, expires_at,
      canceled_at, cancel_reason,
      entry_supervisor_id, entry_supervisor_signature_at,
      attendants, entrants, hazards_present,
      isolation_measures, rescue_service,
      communication_method, equipment_list, notes
    ) values (
      v_done_csp_id, v_tenant_id, 'DEMO-CS-SILO-01',
      'Quarterly inspection of agitator paddle wear',
      v_now - interval '3 days',
      v_now - interval '3 days' + interval '8 hours',
      v_now - interval '2 days' - interval '4 hours',
      'task_complete',
      v_actor_id, v_now - interval '3 days',
      array['Demo Attendant'], array['Demo Entrant'],
      array['Engulfment','Dust','Low O2'],
      array['Rotary valve locked','Fill pneumatic shut','Forced-air at 200 cfm'],
      jsonb_build_object('name','Plant rescue team','phone','+1-555-0100','eta_minutes',5,'equipment',array['SCBA','Tripod']),
      'Tag-line + radio',
      array['SCBA','Tripod','4-gas meter'],
      'DEMO permit — closed cleanly, no incidents.'
    );
    v_csp_count := v_csp_count + 1;

    insert into public.loto_atmospheric_tests
      (id, tenant_id, permit_id, tested_at, tested_by, kind,
       o2_pct, lel_pct, h2s_ppm, co_ppm, notes)
    values
      (gen_random_uuid(), v_tenant_id, v_done_csp_id, v_now - interval '3 days' + interval '5 minutes', v_actor_id, 'pre_entry',
       20.9, 0, 0, 0, 'Pre-entry — pass'),
      (gen_random_uuid(), v_tenant_id, v_done_csp_id, v_now - interval '3 days' + interval '4 hours', v_actor_id, 'periodic',
       20.7, 0, 0, 0, 'Periodic — pass');
    v_at_count := v_at_count + 2;
  end if;

  -- ─── 6. Hot Work Permits (1 active + 2 closed) ─────────────────────────
  if not exists (
    select 1 from public.loto_hot_work_permits
     where tenant_id = v_tenant_id
       and canceled_at is null
       and expires_at > v_now
  ) then
    insert into public.loto_hot_work_permits (
      id, tenant_id, work_location, work_description, work_types,
      equipment_id, started_at, expires_at,
      pai_id, pai_signature_at,
      hot_work_operators, fire_watch_personnel,
      pre_work_checks, notes
    ) values (
      gen_random_uuid(), v_tenant_id,
      'Packaging line A — conveyor frame, north side',
      'Repair weld on cracked conveyor support bracket (DEMO-PKG-CONV-01)',
      array['welding'],
      'DEMO-PKG-CONV-01',
      v_now - interval '30 minutes',
      v_now + interval '7 hours',  -- ≤ 8h cap
      v_actor_id, v_now - interval '30 minutes',
      array['Demo Welder'], array['Demo Fire Watcher'],
      jsonb_build_object(
        'combustibles_cleared_35ft', true,
        'sprinklers_in_service',     true,
        'fire_extinguisher_present', true,
        'fire_watch_assigned',       true,
        'hot_work_area_inspected',   true
      ),
      'DEMO permit — fire watch on for 60 min after work completion per NFPA 51B.'
    );
    v_hw_count := v_hw_count + 1;

    -- Two closed historical permits for the status board.
    insert into public.loto_hot_work_permits (
      id, tenant_id, work_location, work_description, work_types,
      started_at, expires_at, work_completed_at,
      canceled_at, cancel_reason,
      pai_id, pai_signature_at,
      hot_work_operators, fire_watch_personnel, pre_work_checks
    ) values
      (gen_random_uuid(), v_tenant_id,
       'Frying area — fryer #1 vent stack',
       'Cutting old vent collar for replacement',
       array['cutting'],
       v_now - interval '5 days',
       v_now - interval '5 days' + interval '4 hours',
       v_now - interval '5 days' + interval '3 hours',
       v_now - interval '5 days' + interval '4 hours',
       'task_complete',
       v_actor_id, v_now - interval '5 days',
       array['Demo Welder'], array['Demo Fire Watcher'],
       jsonb_build_object('combustibles_cleared_35ft', true, 'sprinklers_in_service', true, 'fire_extinguisher_present', true, 'fire_watch_assigned', true)),
      (gen_random_uuid(), v_tenant_id,
       'Maintenance shop — workbench',
       'Brazing on copper refrigerant line for HVAC replacement',
       array['brazing'],
       v_now - interval '12 days',
       v_now - interval '12 days' + interval '2 hours',
       v_now - interval '12 days' + interval '90 minutes',
       v_now - interval '12 days' + interval '2 hours',
       'task_complete',
       v_actor_id, v_now - interval '12 days',
       array['Demo Welder'], array['Demo Fire Watcher'],
       jsonb_build_object('combustibles_cleared_35ft', true, 'sprinklers_in_service', true, 'fire_extinguisher_present', true, 'fire_watch_assigned', true));
    v_hw_count := v_hw_count + 2;
  end if;

  -- ─── 7. Training Records (6) — DATE columns, role enum from migration 021
  insert into public.loto_training_records
    (id, tenant_id, worker_name, role, completed_at, expires_at, cert_authority, created_by)
  select gen_random_uuid(), v_tenant_id, t.worker_name, t.role,
         (v_now - t.ago)::date, (v_now + t.until)::date,
         'Demo Trainer', v_actor_id
    from (values
      ('Demo Entrant 1',    'entrant',           interval '90 days',  interval '275 days'),
      ('Demo Entrant 2',    'entrant',           interval '120 days', interval '245 days'),
      ('Demo Attendant',    'attendant',         interval '60 days',  interval '305 days'),
      ('Demo Supervisor',   'entry_supervisor',  interval '30 days',  interval '335 days'),
      ('Demo Welder',       'hot_work_operator', interval '180 days', interval '185 days'),
      ('Demo Fire Watcher', 'fire_watcher',      interval '180 days', interval '185 days')
    ) as t(worker_name, role, ago, until)
   where not exists (
     select 1 from public.loto_training_records r
      where r.tenant_id   = v_tenant_id
        and r.worker_name = t.worker_name
        and r.role        = t.role
   );
  get diagnostics v_tr_count = row_count;

  -- ─── 8. Devices (6 padlocks) ────────────────────────────────────────────
  insert into public.loto_devices (id, tenant_id, device_label, kind, description, notes)
  values
    (gen_random_uuid(), v_tenant_id, 'DEMO-LOCK-001', 'padlock',   'Red padlock #1',  'Demo'),
    (gen_random_uuid(), v_tenant_id, 'DEMO-LOCK-002', 'padlock',   'Red padlock #2',  null),
    (gen_random_uuid(), v_tenant_id, 'DEMO-LOCK-003', 'padlock',   'Blue padlock #1', null),
    (gen_random_uuid(), v_tenant_id, 'DEMO-CABLE-01', 'cable',     'Cable lockout',   null),
    (gen_random_uuid(), v_tenant_id, 'DEMO-HASP-01',  'hasp',      'Multi-lock hasp', null),
    (gen_random_uuid(), v_tenant_id, 'DEMO-GBOX-01',  'group_box', 'Group lockbox',   null)
  on conflict (device_label) do nothing;
  get diagnostics v_dv_count = row_count;

  return format(
    'Seeded WLS Demo (#0002): equipment=%s steps=%s reviews=%s spaces=%s csperms=%s atmtests=%s hwperms=%s training=%s devices=%s',
    v_eq_count, v_step_count, v_rev_count, v_cs_count,
    v_csp_count, v_at_count, v_hw_count, v_tr_count, v_dv_count
  );
end;
$$;

-- Run the seed once on this migration's apply.
do $$
declare
  result text;
begin
  result := public.seed_wls_demo();
  raise notice '%', result;
end $$;

commit;
