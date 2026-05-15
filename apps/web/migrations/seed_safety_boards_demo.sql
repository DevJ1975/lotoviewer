-- Demo seed — populates the safety boards module + Command Center safety
-- alert queue for the WLS Demo tenant (tenant_number 0002).
--
-- What it does:
--   1. Creates three boards: General Safety, Lessons Learned, Hazard Watch.
--   2. Adds threads of every kind the schema supports (hazard_report,
--      near_miss_reflection, lesson_learned, alert, question, discussion)
--      including one acknowledgement-required broadcast.
--   3. Adds replies, emoji reactions, and acknowledgements so the trending
--      view + reply counts aren't empty.
--   4. Inserts a Command Center safety-alert row for every existing demo
--      incident, applying the same tone/priority mapping that the live
--      incidents/POST route uses. A mix of statuses (new / acknowledged /
--      in_review / resolved) demonstrates the full state machine.
--
-- Idempotent — every insert is gated on deterministic UUIDs and uses
-- ON CONFLICT DO NOTHING. Re-running is safe.
--
-- This is NOT a numbered migration. Manual run-once-per-tenant seed.
-- Don't run in production.
--
-- Prereqs:
--   • Migrations 074 + 077..080 (boards tier 1-3) + 115 (safety alerts)
--   • seed_incidents_demo.sql already run (we attach alerts to those rows)
--   • WLS Demo tenant exists (slug='wls-demo' or tenant_number='0002')

begin;

do $$
declare
  v_tenant_id    uuid;
  v_author_id    uuid;
  v_member_id    uuid;
  v_board_gen    constant uuid := '22222222-1111-1111-1111-000000000001';
  v_board_lessons constant uuid := '22222222-1111-1111-1111-000000000002';
  v_board_hazard constant uuid := '22222222-1111-1111-1111-000000000003';
  v_th_alert     constant uuid := '22222222-2222-2222-2222-000000000001';
  v_th_hazard    constant uuid := '22222222-2222-2222-2222-000000000002';
  v_th_lesson    constant uuid := '22222222-2222-2222-2222-000000000003';
  v_th_nm        constant uuid := '22222222-2222-2222-2222-000000000004';
  v_th_question  constant uuid := '22222222-2222-2222-2222-000000000005';
  v_th_disc      constant uuid := '22222222-2222-2222-2222-000000000006';
begin
  select id into v_tenant_id from public.tenants
   where slug = 'wls-demo' or tenant_number = '0002'
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    raise notice 'WLS Demo tenant not found — aborting safety-boards seed';
    return;
  end if;

  -- Two demo users: an admin-flavored author and a member commenter.
  select tm.user_id into v_author_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
     and tm.role in ('owner','admin')
   order by tm.created_at asc
   limit 1;
  if v_author_id is null then
    raise notice 'No owner/admin found in WLS Demo — aborting safety-boards seed';
    return;
  end if;

  select tm.user_id into v_member_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
     and tm.user_id <> v_author_id
   order by tm.created_at asc
   limit 1;
  -- Fallback if there is only one member.
  v_member_id := coalesce(v_member_id, v_author_id);

  -- ── 1. Boards ──────────────────────────────────────────────────────────
  insert into public.safety_boards (id, tenant_id, name, slug, description, created_by, allow_anonymous)
  values
    (v_board_gen,     v_tenant_id, 'General Safety',  'general-safety',
     'Site-wide safety discussion, announcements, and questions.', v_author_id, false),
    (v_board_lessons, v_tenant_id, 'Lessons Learned', 'lessons-learned',
     'Published incident summaries and cross-shift learning.', v_author_id, false),
    (v_board_hazard,  v_tenant_id, 'Hazard Watch',    'hazard-watch',
     'Active hazards, near-miss reflections, and floor reports.', v_author_id, true)
  on conflict (id) do nothing;

  -- ── 2. Threads — one per supported kind ────────────────────────────────
  insert into public.safety_board_threads (
    id, tenant_id, board_id, author_user_id, title, body, kind, metadata,
    pinned, acknowledgement_required, linked_entity_type, linked_entity_id,
    last_reply_at, created_at
  )
  values
    -- Broadcast that everyone must acknowledge — links to the lost-time
    -- injury so the "from incident" backlink renders.
    (v_th_alert, v_tenant_id, v_board_gen, v_author_id,
     'Action required: Forklift hydraulic leak on Line 3',
     E'A worker suffered a lost-time injury on Production Line 3 after a hydraulic leak on Forklift F-12. '
     'Effective immediately: pre-shift checks must include a hydraulic line walk-around. Maintenance is '
     'replacing the suspect hose tonight. Please acknowledge so we know everyone has read this.',
     'alert',
     jsonb_build_object('severity','high','area','Production Line 3'),
     true,  -- pinned
     true,  -- acknowledgement required
     'incident', '11111111-aaaa-bbbb-cccc-000000000001',
     now() - interval '4 hours', now() - interval '2 days'),

    -- Hazard report from the floor.
    (v_th_hazard, v_tenant_id, v_board_hazard, v_member_id,
     'Pallet wrap accumulating near Aisle 4 fire extinguisher',
     E'Discarded shrink wrap is piling up against the wall-mounted extinguisher in Aisle 4. '
     'It''s about three feet high right now and partially blocks access. Suggesting we add a '
     'second bin on the south side of the rack and empty the existing one more often.',
     'hazard_report',
     jsonb_build_object('severity','medium','area','Warehouse - Aisle 4','reported_by_role','operator'),
     false, false, null, null,
     now() - interval '6 hours', now() - interval '1 day'),

    -- Lesson learned tied to the property damage incident.
    (v_th_lesson, v_tenant_id, v_board_lessons, v_author_id,
     'Lesson learned: Rack inspection cadence after Aisle 7 impact',
     E'Forklift impact at Aisle 7 upright was caught during the next post-shift walk, but only '
     'because the operator self-reported. Going forward we''re moving rack visual checks from monthly '
     'to weekly on the busiest aisles (4, 7, 11). Engineering certification still required before bay '
     'returns to service.',
     'lesson_learned',
     jsonb_build_object('source_incident','INC-2026-DEMO3'),
     false, false,
     'incident', '11111111-aaaa-bbbb-cccc-000000000003',
     now() - interval '1 day', now() - interval '3 days'),

    -- Near-miss reflection on the unattended pallet shift.
    (v_th_nm, v_tenant_id, v_board_hazard, v_member_id,
     'Why I called the Aisle 4 pallet shift a near-miss',
     E'I stopped abruptly because the path wasn''t clear — a co-worker walked into the aisle without '
     'making eye contact. The pallet shifted but didn''t tip. Two takeaways: I''ll travel with the load '
     'lower, and we should remind everyone that pedestrian-forklift eye contact is non-optional, '
     'including supervisors.',
     'near_miss_reflection',
     jsonb_build_object('source_incident','INC-2026-DEMO2'),
     false, false,
     'near_miss', '11111111-aaaa-bbbb-cccc-000000000002',
     now() - interval '2 days', now() - interval '4 days'),

    -- Open question — the kind that should ping a supervisor.
    (v_th_question, v_tenant_id, v_board_gen, v_member_id,
     'Question: Are face shields required for off-hand grinder use?',
     E'After the metal-sliver eye injury at the grinder station, I want to make sure the rule is '
     'clear. The poster at the bench says "approved eyewear" but I''ve seen safety glasses used. '
     'Should we always be in a face shield or only for specific operations?',
     'question',
     jsonb_build_object('source_incident','INC-2025-DEMO6','tagged_role','safety_lead'),
     false, false,
     'incident', '11111111-aaaa-bbbb-cccc-000000000006',
     now() - interval '5 days', now() - interval '6 days'),

    -- Plain discussion — keeps the board feeling alive.
    (v_th_disc, v_tenant_id, v_board_gen, v_author_id,
     'Heads up: Heat-stress season starts Monday',
     E'Forecast looks like a hot week. Reminder that water + shade + rest cycles kick in at 80F per '
     'the site IIPP and we add a 10-minute cool-down at 95F. Supervisors please post the schedule by '
     'the time clocks Sunday night.',
     'discussion',
     jsonb_build_object('area','site-wide'),
     true,  -- pinned (announcement)
     false, null, null,
     now() - interval '8 hours', now() - interval '12 hours')
  on conflict (id) do nothing;

  -- ── 3. Replies — a couple of threads have responses ────────────────────
  insert into public.safety_board_replies (id, tenant_id, thread_id, author_user_id, body, body_mentions, created_at)
  values
    ('22222222-3333-3333-3333-000000000001', v_tenant_id, v_th_alert, v_member_id,
     'Acknowledged. Walked F-12 with maintenance — hose looked frayed near the swivel.',
     array[]::uuid[], now() - interval '4 hours'),
    ('22222222-3333-3333-3333-000000000002', v_tenant_id, v_th_alert, v_author_id,
     'Thanks. Replacement scheduled tonight; F-12 stays out of service until QC sign-off tomorrow.',
     array[]::uuid[], now() - interval '3 hours'),
    ('22222222-3333-3333-3333-000000000003', v_tenant_id, v_th_hazard, v_author_id,
     'Good catch. Adding a second bin tomorrow and adjusting the housekeeping route.',
     array[]::uuid[], now() - interval '5 hours'),
    ('22222222-3333-3333-3333-000000000004', v_tenant_id, v_th_question, v_author_id,
     'Face shield + safety glasses for any grinding operation, including bench grinders. Updating the JHA today.',
     array[]::uuid[], now() - interval '4 days')
  on conflict (id) do nothing;

  -- ── 4. Reactions — feed the trending view ──────────────────────────────
  insert into public.safety_board_reactions (tenant_id, target_type, target_id, user_id, emoji, created_at)
  values
    (v_tenant_id, 'thread', v_th_alert,   v_member_id, '👍', now() - interval '3 hours'),
    (v_tenant_id, 'thread', v_th_hazard,  v_author_id, '👀', now() - interval '5 hours'),
    (v_tenant_id, 'thread', v_th_lesson,  v_member_id, '📚', now() - interval '1 day'),
    (v_tenant_id, 'thread', v_th_disc,    v_member_id, '☀️', now() - interval '6 hours')
  on conflict do nothing;

  -- ── 5. Acknowledgement on the broadcast thread ─────────────────────────
  insert into public.safety_board_acknowledgements (thread_id, user_id, tenant_id, acknowledged_at, comment, thread_title_at_ack)
  values
    (v_th_alert, v_member_id, v_tenant_id, now() - interval '4 hours',
     'Read and briefed crew.',
     'Action required: Forklift hydraulic leak on Line 3')
  on conflict do nothing;

  -- ── 6. Command Center safety alerts for every demo incident ───────────
  -- Mirrors packages/core/src/incidentSafetyAlerts.ts tone/priority rules.
  -- Mixes status values so the queue shows a realistic spread.
  insert into public.command_center_safety_alerts (
    id, tenant_id, incident_id, report_number, title, summary,
    severity_tone, priority, status, source, created_by,
    acknowledged_by, acknowledged_at, resolved_by, resolved_at, resolution_note,
    created_at, updated_at
  )
  values
    -- INC-2026-DEMO1: injury_illness + lost_time → critical, in_review.
    ('22222222-4444-4444-4444-000000000001', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000001', 'INC-2026-DEMO1',
     'Injury/illness submitted',
     'Production Line 3: Worker slipped on hydraulic oil leak from forklift while loading pallets. Fell onto knee, lost-time treatment.',
     'critical', 90, 'in_review', 'incident_submitted', v_author_id,
     v_author_id, now() - interval '20 days', null, null, null,
     now() - interval '21 days', now() - interval '18 days'),

    -- INC-2026-DEMO2: near_miss + high → warning, acknowledged.
    ('22222222-4444-4444-4444-000000000002', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000002', 'INC-2026-DEMO2',
     'Near-miss submitted',
     'Warehouse — Aisle 4: Pallet shifted when forklift stopped abruptly. Operator caught it before it tipped.',
     'warning', 60, 'acknowledged', 'incident_submitted', v_author_id,
     v_member_id, now() - interval '13 days', null, null, null,
     now() - interval '14 days', now() - interval '13 days'),

    -- INC-2026-DEMO3: property_damage + moderate → attention, resolved.
    ('22222222-4444-4444-4444-000000000003', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000003', 'INC-2026-DEMO3',
     'Property damage submitted',
     'Warehouse — Aisle 7 racking: Forklift impacted upright support of pallet rack. Bay flagged out of service pending engineering.',
     'attention', 30, 'resolved', 'incident_submitted', v_author_id,
     v_author_id, now() - interval '26 days',
     v_author_id, now() - interval '20 days',
     'Bay reopened after engineering certified rack repair. Lessons-learned thread posted.',
     now() - interval '28 days', now() - interval '20 days'),

    -- INC-2026-DEMO4: environmental + extreme potential → critical, new.
    ('22222222-4444-4444-4444-000000000004', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000004', 'INC-2026-DEMO4',
     'Environmental release submitted',
     'Wastewater treatment — chlorination room: Damaged hose released chlorine solution onto secondary containment pad. ~25 lb released.',
     'critical', 90, 'new', 'incident_submitted', v_author_id,
     null, null, null, null, null,
     now() - interval '10 days', now() - interval '10 days'),

    -- INC-2026-DEMO5: near_miss + high → warning, new.
    ('22222222-4444-4444-4444-000000000005', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000005', 'INC-2026-DEMO5',
     'Near-miss submitted',
     'Loading Dock B (demo): Saw a co-worker climbing on top of a pallet to reach an overhead light fixture instead of using a ladder.',
     'warning', 60, 'new', 'incident_submitted', v_author_id,
     null, null, null, null, null,
     now() - interval '9 days', now() - interval '9 days'),

    -- INC-2025-DEMO6: injury_illness + medical → warning, resolved.
    ('22222222-4444-4444-4444-000000000006', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000006', 'INC-2025-DEMO6',
     'Injury/illness submitted',
     'Maintenance shop — grinder station: Worker received metal sliver to right eye while grinding without face shield. First-aid eyewash.',
     'warning', 60, 'resolved', 'incident_submitted', v_author_id,
     v_author_id, now() - interval '95 days',
     v_author_id, now() - interval '85 days',
     'JHA updated to require face shield for all grinder use. Crew briefed.',
     now() - interval '97 days', now() - interval '85 days'),

    -- INC-2026-DEMO7: near_miss + high → warning, escalated (recurring).
    ('22222222-4444-4444-4444-000000000007', v_tenant_id,
     '11111111-aaaa-bbbb-cccc-000000000007', 'INC-2026-DEMO7',
     'Near-miss submitted',
     'Production Line 3: Hydraulic oil leak under forklift again — caught before anyone slipped. Same forklift as INC-2026-DEMO1.',
     'warning', 60, 'escalated', 'incident_submitted', v_author_id,
     v_author_id, now() - interval '7 days', null, null, null,
     now() - interval '8 days', now() - interval '7 days')
  on conflict (id) do nothing;

  raise notice 'WLS Demo safety boards + alerts seeded for tenant %', v_tenant_id;
end $$;

notify pgrst, 'reload schema';

commit;
