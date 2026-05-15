-- Demo seed for the Hazardous Waste module — accumulation areas,
-- inspections, waste streams, and containers for the WLS Demo
-- tenant. Lands the /hazardous-waste hub on a populated dashboard:
--
--   • Active areas    = 4
--   • Overdue         = 2 (one over-cadence, one never-inspected)
--   • Critical (7d)   = 1 (a flagged closed-container fail on Drum Yard)
--   • Recent inspections list has real area names, pass counts,
--     and observations.
--
-- Idempotent: re-running is safe. The seed gates the whole block on
-- whether any area for this tenant carries the 'Demo seed:' prefix
-- in location_notes — same pattern as seed_hot_work_demo.sql.
--
-- This is NOT a numbered migration — it's a seed you run manually
-- against a demo tenant. Do not run it on a real customer tenant.
--
-- Prereqs:
--   • Migrations 140 (streams + containers) and 142 (areas +
--     inspections) applied.
--   • Migration 141 (enable hazardous-waste on every tenant) applied
--     so the module renders in the nav for WLS Demo.
--   • A profile exists for at least one user — used as created_by /
--     inspected_by on the demo rows.
--   • The 'WLS Demo' tenant (slug=wls-demo) exists.

do $$
declare
  v_tenant_id  uuid := 'ddddbce8-c7ab-4855-8bcd-821d080617ee';  -- WLS Demo
  v_actor      uuid;

  v_saa_id     uuid;
  v_caa_id     uuid;
  v_uw_id      uuid;
  v_used_oil   uuid;

  v_stream_solvent uuid;
  v_stream_sludge  uuid;
  v_stream_lamps   uuid;

  -- Built once; per-row overrides keep each inspection distinct.
  -- Matches the shape produced by summarizeHazardousWasteDraft():
  --   [{ check_id, status, note, flagged_critical }]
  -- Counts on the inspection row are derived by the trigger.
  base_findings_saa jsonb := jsonb_build_array(
    jsonb_build_object('check_id','closed-container',       'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','compatible-container',   'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','label-readable',         'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','hazards-marked',         'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','saa-at-point',           'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','saa-volume-under-limit', 'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','accumulation-date',      'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','incompatibles-separated','status','pass','note',null,'flagged_critical',true)
  );
  base_findings_caa jsonb := jsonb_build_array(
    jsonb_build_object('check_id','closed-container',       'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','compatible-container',   'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','label-readable',         'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','hazards-marked',         'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','accumulation-date',      'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','secondary-containment',  'status','pass','note',null,'flagged_critical',false),
    jsonb_build_object('check_id','aisle-access',           'status','pass','note',null,'flagged_critical',false),
    jsonb_build_object('check_id','incompatibles-separated','status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','emergency-info-posted',  'status','pass','note',null,'flagged_critical',false),
    jsonb_build_object('check_id','manifest-ready',         'status','pass','note',null,'flagged_critical',false)
  );
  base_findings_uw jsonb := jsonb_build_array(
    jsonb_build_object('check_id','closed-container',     'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','compatible-container', 'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','label-readable',       'status','pass','note',null,'flagged_critical',true),
    jsonb_build_object('check_id','accumulation-date',    'status','pass','note',null,'flagged_critical',true)
  );
begin
  -- WLS Demo must exist.
  if not exists (select 1 from public.tenants where id = v_tenant_id) then
    raise notice 'WLS Demo tenant (%) not found — skipping hazardous-waste seed.', v_tenant_id;
    return;
  end if;

  -- Pick a profile to attribute writes to. Prefer an admin/owner on
  -- this tenant; fall back to any admin, then any profile.
  select tm.user_id into v_actor
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
     and tm.role in ('owner','admin')
   order by tm.created_at asc
   limit 1;
  if v_actor is null then
    select id into v_actor
      from public.profiles where is_admin = true
      order by created_at asc limit 1;
  end if;
  if v_actor is null then
    select id into v_actor from public.profiles order by created_at asc limit 1;
  end if;
  if v_actor is null then
    raise notice 'No profile rows found — log in once before re-running this seed.';
    return;
  end if;

  -- Idempotency gate: any prior demo area for this tenant means we've
  -- already seeded. Mirrors the hot-work seed's notes-prefix marker.
  if exists (
    select 1 from public.hazardous_waste_areas
     where tenant_id = v_tenant_id
       and location_notes like 'Demo seed:%'
  ) then
    raise notice 'Hazardous-waste demo already seeded for WLS Demo — skipping.';
    return;
  end if;

  -- ── Areas ───────────────────────────────────────────────────────────────
  -- Names chosen to read as plausible plant nomenclature; cadences span
  -- the regulatory norms (7-day for SAA/CAA, monthly for UW, biweekly
  -- for used-oil) so isAreaOverdue() trips on the two we want overdue.

  insert into public.hazardous_waste_areas
    (tenant_id, name, area_type, weekly_cadence_days, location_notes, created_by, updated_by, created_at)
  values
    (v_tenant_id, 'SAA — Line 3 Solvent Drum',     'satellite_accumulation',  7, 'Demo seed: at the press, north side.',                          v_actor, v_actor, now() - interval '40 days')
  returning id into v_saa_id;

  insert into public.hazardous_waste_areas
    (tenant_id, name, area_type, weekly_cadence_days, location_notes, created_by, updated_by, created_at)
  values
    (v_tenant_id, 'CAA — Drum Storage Yard',       'central_accumulation',    7, 'Demo seed: bermed concrete pad behind shipping.',               v_actor, v_actor, now() - interval '60 days')
  returning id into v_caa_id;

  insert into public.hazardous_waste_areas
    (tenant_id, name, area_type, weekly_cadence_days, location_notes, created_by, updated_by, created_at)
  values
    (v_tenant_id, 'UW — Mezzanine Lamp Tote',      'universal_waste',        30, 'Demo seed: spent fluorescent and HID lamps tote, mezzanine landing.', v_actor, v_actor, now() - interval '50 days')
  returning id into v_uw_id;

  insert into public.hazardous_waste_areas
    (tenant_id, name, area_type, weekly_cadence_days, location_notes, created_by, updated_by, created_at)
  values
    (v_tenant_id, 'Used Oil — Maintenance Bay',    'used_oil',               14, 'Demo seed: drain pan and 55-gal collection drum in the lube bay.',   v_actor, v_actor, now() - interval '20 days')
  returning id into v_used_oil;

  -- ── Inspections ─────────────────────────────────────────────────────────
  -- Findings JSONB drives total/pass/critical counts via the
  -- hazardous_waste_inspection_derive_counts() trigger.

  -- SAA: two healthy walk-throughs in cadence.
  insert into public.hazardous_waste_inspections
    (tenant_id, area_id, area_type, inspected_by, inspected_at, findings, observations, created_by, updated_by)
  values
    (v_tenant_id, v_saa_id, 'satellite_accumulation', v_actor,
     now() - interval '2 days',
     base_findings_saa,
     'Demo seed: routine walk-through, all in order.',
     v_actor, v_actor),
    (v_tenant_id, v_saa_id, 'satellite_accumulation', v_actor,
     now() - interval '9 days',
     base_findings_saa,
     'Demo seed: prior week walk-through.',
     v_actor, v_actor);

  -- CAA #1: most recent — one critical fail (closed-container).
  -- Powers the "Critical fails (7d)" tile.
  insert into public.hazardous_waste_inspections
    (tenant_id, area_id, area_type, inspected_by, inspected_at, findings, observations, created_by, updated_by)
  values
    (v_tenant_id, v_caa_id, 'central_accumulation', v_actor,
     now() - interval '1 day',
     jsonb_set(
       base_findings_caa,
       '{0}',
       jsonb_build_object(
         'check_id','closed-container',
         'status','fail',
         'note','Drum CAA-04 bung left finger-tight; corrected on site, root-cause review pending.',
         'flagged_critical', true
       )
     ),
     'Demo seed: open bung found on CAA-04, corrected at the time of walk-through.',
     v_actor, v_actor);

  -- CAA #2: 5 days ago — all pass.
  insert into public.hazardous_waste_inspections
    (tenant_id, area_id, area_type, inspected_by, inspected_at, findings, observations, created_by, updated_by)
  values
    (v_tenant_id, v_caa_id, 'central_accumulation', v_actor,
     now() - interval '5 days',
     base_findings_caa,
     'Demo seed: clean walk-through.',
     v_actor, v_actor);

  -- CAA #3: 12 days ago — one non-critical fail (secondary-containment).
  --   Trigger should see status='fail' but flagged_critical=false →
  --   critical_failures stays 0 on this row.
  insert into public.hazardous_waste_inspections
    (tenant_id, area_id, area_type, inspected_by, inspected_at, findings, observations, created_by, updated_by)
  values
    (v_tenant_id, v_caa_id, 'central_accumulation', v_actor,
     now() - interval '12 days',
     jsonb_set(
       base_findings_caa,
       '{5}',
       jsonb_build_object(
         'check_id','secondary-containment',
         'status','fail',
         'note','Trace residue in the south berm sump; pumped and rinsed.',
         'flagged_critical', false
       )
     ),
     'Demo seed: minor housekeeping in berm sump.',
     v_actor, v_actor);

  -- UW: 35 days ago — past 30-day cadence → overdue tile +1.
  insert into public.hazardous_waste_inspections
    (tenant_id, area_id, area_type, inspected_by, inspected_at, findings, observations, created_by, updated_by)
  values
    (v_tenant_id, v_uw_id, 'universal_waste', v_actor,
     now() - interval '35 days',
     base_findings_uw,
     'Demo seed: monthly UW lamp tote check.',
     v_actor, v_actor);

  -- Used Oil: deliberately no inspections — daysSinceLastInspection()
  -- returns null, isAreaOverdue() returns true → overdue tile +1.

  -- ── Streams ─────────────────────────────────────────────────────────────
  insert into public.hazardous_waste_streams
    (tenant_id, name, generating_process, description, physical_state,
     hazards, waste_codes, generator_category, status, owner_user_id,
     determination_basis, notes, created_by, updated_by)
  values
    (v_tenant_id,
     'Spent solvent blend (acetone / IPA)',
     'Parts cleaning at Line 3 press',
     'Mixed flammable solvent from manual wipe-down of press tooling.',
     'liquid',
     array['flammable']::text[],
     array['F003','F005']::text[],
     'lqg', 'active', v_actor,
     'Listed under F003 (acetone) and F005 (IPA) per 40 CFR 261.31.',
     'Demo seed: profile reviewed; TSDF lab pack manifest on file.',
     v_actor, v_actor)
  returning id into v_stream_solvent;

  insert into public.hazardous_waste_streams
    (tenant_id, name, generating_process, description, physical_state,
     hazards, waste_codes, generator_category, status, owner_user_id,
     determination_basis, notes, created_by, updated_by)
  values
    (v_tenant_id,
     'Mixed metals shop sludge',
     'Grinding-booth dust collection sump',
     'Wet sludge from the wet collector serving the grinding booths.',
     'sludge',
     array['toxic']::text[],
     array['D006','D008']::text[],
     'lqg', 'active', v_actor,
     'TCLP results 2026-02 confirm Cd (D006) and Pb (D008) above regulatory levels.',
     'Demo seed: re-test scheduled annually; profile current.',
     v_actor, v_actor)
  returning id into v_stream_sludge;

  insert into public.hazardous_waste_streams
    (tenant_id, name, generating_process, description, physical_state,
     hazards, waste_codes, generator_category, status, owner_user_id,
     notes, created_by, updated_by)
  values
    (v_tenant_id,
     'Universal waste lamps — fluorescent / HID',
     'Lamp replacement, plant-wide',
     'Spent linear fluorescent, CFL, and HID lamps managed as universal waste.',
     'solid',
     array['mercury']::text[],
     array[]::text[],
     'lqg', 'active', v_actor,
     'Demo seed: tote-based collection, recycled via UW handler.',
     v_actor, v_actor)
  returning id into v_stream_lamps;

  -- ── Containers ─────────────────────────────────────────────────────────
  insert into public.hazardous_waste_containers
    (tenant_id, stream_id, label, area_type, area_location,
     accumulation_started_at, volume_quantity, volume_unit, status,
     notes, created_by, updated_by)
  values
    (v_tenant_id, v_stream_solvent,
     'CAA-04 (solvent, 55-gal steel)',
     'central_accumulation',
     'Drum Storage Yard, position 4',
     now() - interval '35 days',
     55, 'gallons', 'open',
     'Demo seed: aging container — drives the "open over-limit drums first" hint.',
     v_actor, v_actor),
    (v_tenant_id, v_stream_sludge,
     'SAA-Grind-1 (sludge, 30-gal poly)',
     'satellite_accumulation',
     'Grinding booth, point of generation',
     now() - interval '2 days',
     30, 'gallons', 'open',
     'Demo seed: fresh satellite container under the daily generation point.',
     v_actor, v_actor),
    (v_tenant_id, v_stream_lamps,
     'UW-Lamps-Tote-1',
     'universal_waste',
     'Mezzanine landing',
     now() - interval '90 days',
     null, null, 'open',
     'Demo seed: lamps tote — universal waste, no accumulation-time aging.',
     v_actor, v_actor);

  raise notice 'Seeded hazardous-waste demo for WLS Demo: % areas, % inspections, % streams, % containers.',
    (select count(*) from public.hazardous_waste_areas        where tenant_id = v_tenant_id and location_notes like 'Demo seed:%'),
    (select count(*) from public.hazardous_waste_inspections  where tenant_id = v_tenant_id and observations  like 'Demo seed:%'),
    (select count(*) from public.hazardous_waste_streams      where tenant_id = v_tenant_id and notes         like 'Demo seed:%'),
    (select count(*) from public.hazardous_waste_containers   where tenant_id = v_tenant_id and notes         like 'Demo seed:%');
end $$;
