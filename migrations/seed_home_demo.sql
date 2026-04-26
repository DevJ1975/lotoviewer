-- Demo seed for the home screen at /. Adds a SECOND active permit on a
-- different space + a few extra atmospheric tests so the home's
-- "Active Permits" panel and "Recent Activity" feed look populated for a
-- client walkthrough.
--
-- Companion to migrations/seed_confined_spaces_demo.sql — run BOTH for the
-- full demo state. Run order doesn't matter; both are idempotent and use
-- existence checks before inserting.
--
-- This is NOT a numbered migration — manual run-once-per-tenant seed.
-- Don't run in production.
--
-- Prereqs:
--   • Migrations 009-011 applied (confined-space tables + permit serials)
--   • seed_confined_spaces_demo.sql already applied (the spaces this references
--     must exist; we don't re-seed them here)
--   • At least one row in public.profiles

-- ────────────────────────────────────────────────────────────────────────────
-- Demo permit #2 — fermenter (CO2 hazard) with active periodic readings.
-- Different space than seed_confined_spaces_demo so the home's Active Permits
-- panel shows TWO different spaces side by side. Different expiry too so the
-- countdown timers visibly differ.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  demo_supervisor uuid;
  demo_permit_id  uuid;
  signed_at       timestamptz;
begin
  -- Same supervisor lookup pattern as the other seed.
  select id into demo_supervisor
    from public.profiles
   where is_admin = true
   order by created_at asc
   limit 1;

  if demo_supervisor is null then
    select id into demo_supervisor
      from public.profiles
     order by created_at asc
     limit 1;
  end if;

  if demo_supervisor is null then
    raise notice '[seed_home_demo] No profile rows — log in once to create one before re-running.';
    return;
  end if;

  -- Skip if a permit already exists for CS-FERM-A; re-runs of this seed
  -- shouldn't pile up active permits on the same space.
  if exists (
    select 1 from public.loto_confined_space_permits
     where space_id = 'CS-FERM-A' and canceled_at is null
  ) then
    raise notice '[seed_home_demo] CS-FERM-A already has an active permit — skipping.';
    return;
  end if;

  -- Skip if the space itself doesn't exist (user didn't run
  -- seed_confined_spaces_demo first).
  if not exists (select 1 from public.loto_confined_spaces where space_id = 'CS-FERM-A') then
    raise notice '[seed_home_demo] CS-FERM-A not found — run seed_confined_spaces_demo.sql first.';
    return;
  end if;

  -- Active permit, signed 35 minutes ago, expires in 5h. Puts it solidly
  -- in the "safe" tone on the home countdown but still visibly active.
  signed_at := now() - interval '35 minutes';

  insert into public.loto_confined_space_permits (
    space_id, purpose, started_at, expires_at,
    entry_supervisor_id, entry_supervisor_signature_at,
    attendants, entrants, hazards_present,
    isolation_measures, rescue_service,
    communication_method, equipment_list,
    notes
  ) values (
    'CS-FERM-A',
    'Inspect and clean residual yeast slurry from the cone bottom',
    now() - interval '40 minutes',
    now() + interval '5 hours',
    demo_supervisor,
    signed_at,
    array['Maria Lopez'],
    array['Tomás Reyes'],
    array['CO2 displacement (active fermentation generates ~50× volume CO2)',
          'Residual ethanol vapors (LEL)',
          'Yeast slurry on bottom — slip and engulfment',
          'Cold chamber — hypothermia risk during long entries'],
    array['24h post-fermentation purge with forced air completed',
          'CO2 verified < 0.5% via pre-entry test',
          'LOTO applied on CIP supply at boundary',
          'LOTO applied on pressure transmitter'],
    '{"name": "Site rescue team", "phone": "x4444", "eta_minutes": 5,
       "equipment": ["Davit arm with winch", "Full-body harness with retrieval line",
                     "SCBA (one set staged at the manway)"]}'::jsonb,
    'Voice contact + radio on Channel 4',
    array['BW MicroClip XL 4-gas monitor (cal''d 2026-04-22)',
          'FR coveralls', 'Insulated chemical gloves',
          'Hard hat with chin strap', 'Steel-toed slip-resistant boots',
          'Class I Div 2 LED headlamp (low-temp rated)'],
    'Demo permit #2 — paired with seed_confined_spaces_demo so the home '
    || 'Active Permits panel shows two distinct spaces.'
  )
  returning id into demo_permit_id;

  -- Pre-entry test (passing) ~ 5 min before sign.
  insert into public.loto_atmospheric_tests
    (permit_id, tested_at, tested_by, kind, o2_pct, lel_pct, h2s_ppm, co_ppm, instrument_id, notes)
  values
    (demo_permit_id, signed_at - interval '5 minutes', demo_supervisor,
     'pre_entry', 20.7, 0, 0, 0, 'BW-MCXL-7841',
     'Cold tank — verify CO2 below acceptable threshold via 4-gas O2 reading.');

  -- Two periodic tests during entry, both passing.
  insert into public.loto_atmospheric_tests
    (permit_id, tested_at, tested_by, kind, o2_pct, lel_pct, h2s_ppm, co_ppm, instrument_id)
  values
    (demo_permit_id, signed_at + interval '10 minutes', demo_supervisor,
     'periodic', 20.6, 0, 0, 0, 'BW-MCXL-7841'),
    (demo_permit_id, signed_at + interval '25 minutes', demo_supervisor,
     'periodic', 20.5, 0, 0, 0, 'BW-MCXL-7841');

  raise notice '[seed_home_demo] Seeded CS-FERM-A demo permit (id %) with 3 atmospheric tests.', demo_permit_id;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- A few extra equipment edits to populate the Recent Activity feed.
-- These are no-op updates (touching updated_at) so the audit_log fires —
-- they don't actually change any equipment data.
--
-- Only fires if there's at least one equipment row to update. Picks the
-- 3 oldest by ID so we don't accidentally hammer recently-edited rows.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  ids text[];
begin
  select array_agg(equipment_id order by equipment_id asc) into ids
    from (
      select equipment_id from public.loto_equipment
       where decommissioned = false
       order by equipment_id asc
       limit 3
    ) t;

  if ids is null or array_length(ids, 1) is null then
    raise notice '[seed_home_demo] No equipment rows — skipping activity-feed seed.';
    return;
  end if;

  update public.loto_equipment
     set updated_at = now()
   where equipment_id = any(ids);

  raise notice '[seed_home_demo] Touched % equipment row(s) to populate Recent Activity.', array_length(ids, 1);
end $$;
