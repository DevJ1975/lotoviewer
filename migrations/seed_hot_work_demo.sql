-- Demo seed for the Hot Work module — six permits across the full
-- six-state lifecycle so a client walkthrough lands on a populated
-- /hot-work list, status board, and home alerts card immediately.
--
-- Idempotent: re-running is safe. The seed checks for an existing
-- demo marker in the notes field and skips when found.
--
-- This is NOT a numbered migration — it's a seed file you run manually
-- in the Supabase SQL Editor when you want to populate a demo tenant.
-- Don't run it in production.
--
-- Prereqs:
--   • Migrations 019 (hot_work table), 020 (triggers), and 021
--     (training-role CHECK extension) applied.
--   • At least one row in public.profiles (created automatically when
--     a user logs in for the first time) — used as the PAI on every
--     demo permit.
--   • Optional: seed_confined_spaces_demo.sql run first, so permit #5
--     can wire the §1910.146(f)(15) cross-reference to CS-MIX-04.
--
-- What lands:
--   1. Pending signature   — exercises the sign flow + checklist UI
--   2. Active (mid-life)   — ~5h remaining, healthy countdown
--   3. Active (near expiry) — ~25 min left → triggers home alert tile
--   4. Post-work fire watch — 25 min into a 60-min watch → home tile
--   5. Active + linked to CS-MIX-04 — shows §1910.146(f)(15) banner
--      on both detail pages (skipped if CS-MIX-04 has no live permit)
--   6. Closed (task_complete) — audit-trail example

-- ────────────────────────────────────────────────────────────────────────────
-- Six demo permits across the lifecycle, plus the training-record rows
-- for their operators / watchers (so the sign-gate's training validation
-- sees current certs and doesn't trip the soft-block).
--
-- Both inserts share one DO block under a single existence check. A
-- prior version used `INSERT ... ON CONFLICT DO NOTHING` for the
-- training rows, but loto_training_records has no unique constraint
-- beyond the auto-generated UUID primary key — the ON CONFLICT was a
-- no-op and re-running multiplied the training rows. Gating both
-- inserts behind the same `notes like 'Demo seed:%'` marker on the
-- permits table keeps the seed truly idempotent.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  demo_pai      uuid;
  cs_permit_id  uuid;
  -- Standard pre-work checks block reused across permits with minor
  -- per-row overrides (sprinklers, confined_space, etc.). Building it
  -- once keeps the inserts readable.
  base_checks   jsonb := jsonb_build_object(
    'combustibles_cleared_35ft',     true,
    'floor_swept',                   true,
    'floor_openings_protected',      true,
    'wall_openings_protected',       true,
    'sprinklers_operational',        true,
    'ventilation_adequate',          true,
    'fire_extinguisher_present',     true,
    'fire_extinguisher_type',        'ABC',
    'curtains_or_shields_in_place',  true,
    'gas_lines_isolated',            null,    -- N/A — work doesn't involve gas
    'adjacent_areas_notified',       true,
    'confined_space',                false,
    'elevated_work',                 false,
    'designated_area',               false
  );
begin
  -- PAI = first admin profile, fall back to any profile.
  select id into demo_pai
    from public.profiles
   where is_admin = true
   order by created_at asc
   limit 1;
  if demo_pai is null then
    select id into demo_pai from public.profiles order by created_at asc limit 1;
  end if;
  if demo_pai is null then
    raise notice 'No profile rows found — log in once before re-running this seed.';
    return;
  end if;

  -- Skip the whole block if the demo has already been seeded. We use a
  -- distinctive notes prefix as the marker rather than a serial pattern
  -- because serials are auto-generated and the date prefix changes.
  if exists (
    select 1 from public.loto_hot_work_permits
     where notes like 'Demo seed:%'
  ) then
    raise notice 'Hot-work demo permits already exist — skipping insert.';
    return;
  end if;

  -- Look up an active CS permit on CS-MIX-04 for the cross-link demo
  -- (permit #5). Null when the CS demo wasn't seeded — the seed handles
  -- that gracefully by skipping permit #5.
  select id into cs_permit_id
    from public.loto_confined_space_permits
   where space_id = 'CS-MIX-04'
     and canceled_at is null
   order by created_at desc
   limit 1;

  -- ── Training records ───────────────────────────────────────────────────
  -- Operators + fire watchers named on the demo rosters. Inserted under
  -- the same existence check as the permits so re-runs don't multiply
  -- the rows. Uses (worker_name, role, notes='Demo seed.') as the de-
  -- facto identity for filtering on cleanup, since the table has no
  -- unique constraint on (worker_name, role).
  insert into public.loto_training_records
    (worker_name, role, completed_at, expires_at, cert_authority, notes)
  values
    -- Operators
    ('Alex Kim',     'hot_work_operator', current_date - interval '4 months', current_date + interval '8 months',  'AWS D1.1 (in-house refresher)', 'Demo seed.'),
    ('Maria Lopez',  'hot_work_operator', current_date - interval '2 months', current_date + interval '10 months', 'AWS D1.1 (in-house refresher)', 'Demo seed.'),
    ('Sam Chen',     'hot_work_operator', current_date - interval '6 months', current_date + interval '6 months',  'AWS D1.1 (in-house refresher)', 'Demo seed.'),
    ('John Smith',   'hot_work_operator', current_date - interval '1 month',  current_date + interval '11 months', 'AWS D1.1 (in-house refresher)', 'Demo seed.'),
    -- Fire watchers — separate roster per Cal/OSHA §6777 (no overlap)
    ('Diana Park',   'fire_watcher',      current_date - interval '3 months', current_date + interval '9 months',  'NFPA 51B fire-watch training',  'Demo seed.'),
    ('Mike O''Brien','fire_watcher',      current_date - interval '5 months', current_date + interval '7 months',  'NFPA 51B fire-watch training',  'Demo seed.'),
    ('Jane Doe',     'fire_watcher',      current_date - interval '2 months', current_date + interval '10 months', 'NFPA 51B fire-watch training',  'Demo seed.');

  -- ── 1. Pending signature ───────────────────────────────────────────────
  --     Created 5 min ago, no PAI signature. Use this to exercise the
  --     sign-gate UI: the form is fully populated, the sign button
  --     should activate as soon as the supervisor signs.
  insert into public.loto_hot_work_permits (
    work_location, work_description, work_types,
    started_at, expires_at,
    pai_id, hot_work_operators, fire_watch_personnel,
    pre_work_checks, notes
  ) values (
    'Bay 4 south wall — conveyor support bracket',
    'Weld repair on the cracked support bracket above the case-packer infeed.',
    array['welding']::text[],
    now() - interval '5 minutes',
    now() + interval '4 hours',
    demo_pai,
    array['Alex Kim'],
    array['Diana Park'],
    base_checks,
    'Demo seed: pending signature. Walks the sign flow + checklist UI.'
  );

  -- ── 2. Active mid-life ─────────────────────────────────────────────────
  --     Signed 30 min ago, expires in ~5h. Healthy countdown — the
  --     status board card renders emerald.
  insert into public.loto_hot_work_permits (
    work_location, work_description, work_types,
    started_at, expires_at,
    pai_id, pai_signature_at,
    hot_work_operators, fire_watch_personnel,
    fire_watch_signature_at, fire_watch_signature_name,
    pre_work_checks, notes
  ) values (
    'Boiler room mezzanine — steam line elbow',
    'Cut and replace corroded 2-inch steam line elbow on the upper mezzanine return.',
    array['cutting','welding']::text[],
    now() - interval '30 minutes',
    now() + interval '5 hours',
    demo_pai,
    now() - interval '30 minutes',
    array['Maria Lopez'],
    array['Mike O''Brien'],
    now() - interval '28 minutes',
    'Mike O''Brien',
    base_checks,
    'Demo seed: active mid-life. Healthy countdown for the status board.'
  );

  -- ── 3. Active near expiry ──────────────────────────────────────────────
  --     Signed 7h35m ago, expires in ~25 min. Triggers the home
  --     "expiring soon" alert (<30 min) and the status board's
  --     "Expiring (≤30 min)" headline tile.
  insert into public.loto_hot_work_permits (
    work_location, work_description, work_types,
    started_at, expires_at,
    pai_id, pai_signature_at,
    hot_work_operators, fire_watch_personnel,
    fire_watch_signature_at, fire_watch_signature_name,
    pre_work_checks, notes
  ) values (
    'Loading dock canopy — overhead trolley track',
    'Brazing repair on the dock-3 overhead trolley track suspension lug.',
    array['brazing']::text[],
    now() - interval '7 hours 35 minutes',
    now() + interval '25 minutes',
    demo_pai,
    now() - interval '7 hours 35 minutes',
    array['Sam Chen'],
    array['Diana Park'],
    now() - interval '7 hours 33 minutes',
    'Diana Park',
    base_checks,
    'Demo seed: active near expiry. Triggers the home alert tile.'
  );

  -- ── 4. Post-work fire watch ────────────────────────────────────────────
  --     work_completed_at = 25 min ago, post_watch_minutes = 60 →
  --     ~35 min remaining on the watch. Triggers the home
  --     "fire watch active" tile and the status board's blue card.
  insert into public.loto_hot_work_permits (
    work_location, work_description, work_types,
    started_at, expires_at,
    pai_id, pai_signature_at,
    hot_work_operators, fire_watch_personnel,
    fire_watch_signature_at, fire_watch_signature_name,
    work_completed_at, post_watch_minutes,
    pre_work_checks, notes
  ) values (
    'Outside compressor room — east structural channel',
    'Grinding rust off structural channel before painting.',
    array['grinding']::text[],
    now() - interval '3 hours 25 minutes',
    now() + interval '4 hours 35 minutes',
    demo_pai,
    now() - interval '3 hours 25 minutes',
    array['John Smith'],
    array['Jane Doe'],
    now() - interval '3 hours 23 minutes',
    'Jane Doe',
    now() - interval '25 minutes',
    60,
    base_checks,
    'Demo seed: post-work fire watch. ~35 min remaining on the 60-min NFPA 51B watch.'
  );

  -- ── 5. Active + linked to CS permit ────────────────────────────────────
  --     Sets associated_cs_permit_id and pre_work_checks.confined_space=true
  --     so both detail pages render the cross-link banner. Skipped when
  --     the CS demo wasn't seeded (cs_permit_id is null).
  if cs_permit_id is not null then
    insert into public.loto_hot_work_permits (
      work_location, work_description, work_types,
      associated_cs_permit_id,
      started_at, expires_at,
      pai_id, pai_signature_at,
      hot_work_operators, fire_watch_personnel,
      fire_watch_signature_at, fire_watch_signature_name,
      pre_work_checks, notes
    ) values (
      'Inside CS-MIX-04 — agitator shaft seal flange',
      'Repair weld on the agitator shaft seal flange. Concurrent with the active CS-MIX-04 entry permit.',
      array['welding']::text[],
      cs_permit_id,
      now() - interval '15 minutes',
      now() + interval '3 hours',
      demo_pai,
      now() - interval '15 minutes',
      array['Alex Kim'],
      array['Mike O''Brien'],
      now() - interval '13 minutes',
      'Mike O''Brien',
      base_checks || jsonb_build_object('confined_space', true),
      'Demo seed: linked to CS-MIX-04. Demonstrates §1910.146(f)(15) cross-reference.'
    );
  end if;

  -- ── 6. Closed (task_complete) ──────────────────────────────────────────
  --     Full lifecycle: signed, worked, watched, closed normally. Lives
  --     in the "canceled" state filter on the list page and is the
  --     happy-path audit example.
  insert into public.loto_hot_work_permits (
    work_location, work_description, work_types,
    started_at, expires_at,
    pai_id, pai_signature_at,
    hot_work_operators, fire_watch_personnel,
    fire_watch_signature_at, fire_watch_signature_name,
    work_completed_at, post_watch_minutes,
    canceled_at, cancel_reason, cancel_notes,
    pre_work_checks, notes
  ) values (
    'Maintenance shop bay 2 — replacement guard',
    'Cut sheet steel for replacement chain-conveyor guard.',
    array['cutting']::text[],
    now() - interval '1 day 6 hours',
    now() - interval '1 day 2 hours',
    demo_pai,
    now() - interval '1 day 6 hours',
    array['Maria Lopez'],
    array['Diana Park'],
    now() - interval '1 day 5 hours 58 minutes',
    'Diana Park',
    now() - interval '1 day 4 hours',
    60,
    now() - interval '1 day 3 hours',
    'task_complete',
    'Cuts complete; fire watch elapsed without incident.',
    base_checks,
    'Demo seed: closed normally. Happy-path audit example.'
  );

  raise notice 'Seeded hot-work demo: % permits, % training records.',
    (select count(*) from public.loto_hot_work_permits where notes like 'Demo seed:%'),
    (select count(*) from public.loto_training_records  where notes = 'Demo seed.');
end $$;
