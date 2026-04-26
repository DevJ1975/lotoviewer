-- Demo seed for the Confined Space module — eight spaces across types
-- and classifications, plus an active permit on CS-MIX-04 with two
-- atmospheric tests (pre-entry passing, then one periodic passing) so a
-- client walkthrough lands on a fully populated permit immediately.
--
-- Idempotent: re-running is safe. Existing space_ids are left alone via
-- ON CONFLICT DO NOTHING; the permit + test inserts only run when no
-- existing permit for CS-MIX-04 is found.
--
-- This is NOT a numbered migration — it's a seed file you run manually
-- in the Supabase SQL Editor when you want to populate a demo tenant.
-- Don't run it in production.
--
-- Prereqs:
--   • Migration 009 applied (the three confined-space tables exist)
--   • At least one row in public.profiles (created automatically when
--     a user logs in for the first time)

-- ────────────────────────────────────────────────────────────────────────────
-- Spaces — eight examples spanning types and classifications
-- ────────────────────────────────────────────────────────────────────────────
insert into public.loto_confined_spaces
  (space_id, description, department, classification, space_type,
   entry_dimensions, known_hazards, isolation_required, internal_notes)
values
  -- Tank with stricter atmospheric override (CIP residue can emit H2S)
  ('CS-MIX-04',
   'South side mixing tank #4 (1500 gal jacketed, CIP-served)',
   'Packaging',
   'permit_required',
   'tank',
   '24-inch top manway',
   array['Engulfment from residual product',
         'Residual caustic at 140-180°F (CIP cycle)',
         'Limited egress via single top manway',
         'Agitator shaft entanglement'],
   'LOTO on EQ-MIX-04 main disconnect (Panel PDB-5); ' ||
   'blank flange CIP supply at the boundary; ' ||
   'drain and rinse the tank before entry',
   'Demo space — use this for client walkthroughs. CIP residue makes '
   || 'H2S a real concern; permit override tightens the H2S cap.'),

  -- Silo — dust hazard, biological O2 consumption
  ('CS-SILO-01',
   'Flour silo east — 30-ton capacity, pneumatic top fill',
   'Bakery',
   'permit_required',
   'silo',
   'Top hatch 18 inches; rescue tripod required',
   array['Engulfment in flour',
         'Dust explosion (LEL applies to flour suspension)',
         'O2 deficiency from biological respiration in stored grain',
         'Vertical entry > 5 ft requires retrieval line'],
   'LOTO on rotary valve at silo discharge; ' ||
   'lock out the pneumatic fill valve at the silo wall; ' ||
   'continuous forced-air ventilation during entry',
   null),

  -- Vessel — fermenter with CO2 displacement
  ('CS-FERM-A',
   'Fermenter A (3000 gal stainless, primary fermentation)',
   'Brewing',
   'permit_required',
   'vessel',
   '20-inch top manway, ladder rungs inside',
   array['CO2 displacement (active fermentation generates ~50× volume CO2)',
         'Residual ethanol vapors (LEL)',
         'Yeast slurry on bottom — slip and engulfment',
         'Cold chamber — hypothermia risk during long entries'],
   'Allow 24h post-fermentation purge with forced air; ' ||
   'verify CO2 < 0.5%; ' ||
   'LOTO on CIP supply and pressure transmitter',
   null),

  -- Pit — H2S from organic matter
  ('CS-PIT-02',
   'CIP drain pit beside CIP-2 station',
   'Packaging',
   'permit_required',
   'pit',
   '36 × 36 inch grate; vertical drop 8 ft',
   array['H2S evolution from organic matter in CIP returns',
         'Slip hazard from residual caustic and product',
         'Limited egress — single ladder',
         'Submersible pump electrical hazard'],
   'LOTO on submersible pump at the pit junction box; ' ||
   'block CIP-2 return with knife valve',
   null),

  -- Vault — thermal hazard
  ('CS-VAULT-02',
   'Steam-line vault behind boiler room',
   'Utilities',
   'permit_required',
   'vault',
   'Lift-off cover, 30 × 48 inch; depth 6 ft',
   array['Thermal burns from live steam lines (180 PSIG)',
         'Steam release if a flange weeps during entry',
         'Limited egress — single top opening',
         'Confined geometry around piping'],
   'Block-and-bleed both steam supplies upstream; ' ||
   'verify zero pressure at gauge before entry',
   null),

  -- Hopper — engulfment + dust
  ('CS-HOPPER-7',
   'Sugar hopper #7 — feeds the depositing line',
   'Confectionery',
   'permit_required',
   'hopper',
   '18-inch top access port',
   array['Engulfment in flowable sugar',
         'Dust explosion (LEL for sugar dust)',
         'Limited egress',
         'Rotary valve mechanical hazard at the discharge'],
   'LOTO on the depositing-line conveyor and the hopper rotary valve; ' ||
   'block the sugar conveyor feeding the hopper',
   null),

  -- "Other" type — tunnel oven for cleaning
  ('CS-OVEN-3',
   'Tunnel oven #3 (cooled, for cleaning entry only)',
   'Bakery',
   'permit_required',
   'other',
   'Side service door 48 × 48 inches',
   array['Residual heat from refractory (verify <100°F before entry)',
         'CO from incomplete combustion (run blower 30 min before entry)',
         'Confined geometry around the chain conveyor',
         'Slip hazard from cleaning chemicals'],
   'LOTO on burner gas train (manual + solenoid); ' ||
   'LOTO on conveyor drive; ' ||
   'allow 4h cooldown minimum',
   null),

  -- Non-permit example — to show classification distinction
  ('CS-SUMP-01',
   'Floor drain sump (clear-water CIP rinse return)',
   'Production',
   'non_permit',
   'sump',
   '24-inch grate; depth 4 ft',
   array['Slip hazard'],
   null,
   'Non-permit — included to demo the classification distinction. '
   || 'Reclassified during the 2026 program review after H2S monitoring '
   || 'showed consistent <1 ppm and CIP returns are clear-water only.')
on conflict (space_id) do nothing;

-- Per-space atmospheric override on CS-MIX-04 — stricter H2S cap because
-- CIP residue can emit it. JSON shape matches AcceptableConditions in
-- lib/types.ts.
update public.loto_confined_spaces
   set acceptable_conditions = '{"h2s_max": 5}'::jsonb
 where space_id = 'CS-MIX-04'
   and acceptable_conditions is null;

-- ────────────────────────────────────────────────────────────────────────────
-- Demo permit + atmospheric tests on CS-MIX-04
-- Looks up the first admin profile to act as the entry supervisor; falls
-- back to any profile if no admin exists. Skips the permit insert if one
-- already exists for CS-MIX-04 so re-running is safe.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  demo_supervisor uuid;
  demo_permit_id  uuid;
  signed_at       timestamptz;
begin
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
    raise notice 'No profile rows found — log in once to create one before re-running this seed.';
    return;
  end if;

  if exists (select 1 from public.loto_confined_space_permits where space_id = 'CS-MIX-04') then
    raise notice 'CS-MIX-04 already has a permit; skipping demo permit insert.';
    return;
  end if;

  signed_at := now() - interval '15 minutes';

  insert into public.loto_confined_space_permits (
    space_id, purpose, started_at, expires_at,
    entry_supervisor_id, entry_supervisor_signature_at,
    attendants, entrants, hazards_present,
    isolation_measures, rescue_service,
    communication_method, equipment_list,
    notes
  ) values (
    'CS-MIX-04',
    'Replace level sensor and inspect agitator shaft seal',
    now() - interval '20 minutes',
    now() + interval '6 hours',
    demo_supervisor,
    signed_at,
    array['Alex Kim'],
    array['Jane Doe', 'John Smith'],
    array['Engulfment from residual product',
          'Residual caustic at 140-180°F (CIP cycle)',
          'Limited egress via single top manway',
          'Agitator shaft entanglement'],
    array['LOTO applied on EQ-MIX-04 main disconnect at Panel PDB-5',
          'Blank flange installed on CIP supply at boundary',
          'Tank drained and triple-rinsed; pH verified neutral',
          'Forced-air ventilation @ 250 CFM through top manway'],
    '{"name": "Site rescue team", "phone": "x4444", "eta_minutes": 5,
       "equipment": ["Tripod and winch", "Full-body harness with retrieval line",
                     "SCBA (one set staged at the manway)"]}'::jsonb,
    'Voice contact + radio on Channel 3 (backup)',
    array['BW MicroClip XL 4-gas monitor (cal''d 2026-04-22)',
          'FR coveralls', 'Nitrile chemical gloves',
          'Hard hat with chin strap', 'Steel-toed slip-resistant boots',
          'Class I Div 1 LED headlamp', 'Tyvek QC125 chemical suit (staged)'],
    'Demo permit. Pre-entry test ran ~5 min before signing; first periodic '
    || 'taken 10 min after entry began.'
  )
  returning id into demo_permit_id;

  -- Pre-entry reading — passing all four channels.
  insert into public.loto_atmospheric_tests (
    permit_id, tested_at, tested_by, kind,
    o2_pct, lel_pct, h2s_ppm, co_ppm,
    instrument_id, notes
  ) values (
    demo_permit_id,
    signed_at - interval '5 minutes',
    demo_supervisor,
    'pre_entry',
    20.9, 0, 0, 0,
    'BW-MCXL-7841',
    'Pre-entry reading taken from inside the manway with sample tube extended to the tank floor.'
  );

  -- Periodic reading 10 minutes into the entry — still passing.
  insert into public.loto_atmospheric_tests (
    permit_id, tested_at, tested_by, kind,
    o2_pct, lel_pct, h2s_ppm, co_ppm,
    instrument_id, notes
  ) values (
    demo_permit_id,
    signed_at + interval '10 minutes',
    demo_supervisor,
    'periodic',
    20.8, 0, 0.5, 0,
    'BW-MCXL-7841',
    null
  );

  raise notice 'Seeded CS-MIX-04 demo permit (id %) with 2 atmospheric tests.', demo_permit_id;
end $$;
