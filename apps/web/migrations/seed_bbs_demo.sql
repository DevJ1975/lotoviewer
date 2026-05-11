-- Demo seed — populates the Behavior-Based Safety (BBS) module for a
-- client walkthrough.
--
-- Creates a realistic mix of QR locations, observations across all
-- three kinds (unsafe_act, unsafe_condition, safe_behavior), the
-- full close-out workflow (open → in_progress → closed), one
-- anonymous QR submission, ABC analysis examples, and a few
-- timeline actions so the leaderboard and scorecard have data.
--
-- Idempotent — every insert uses a deterministic id and ON CONFLICT
-- DO NOTHING. Re-running is safe; nothing piles up.
--
-- This is NOT a numbered migration — manual run-once-per-tenant
-- seed. Don't run in production.
--
-- Prereqs:
--   • Migration 081 applied (bbs_* tables exist)
--   • At least one tenant flagged is_demo=true
--   • At least one tenant_membership on the demo tenant (we use the
--     oldest member as the "reporter")

do $$
declare
  v_tenant_id   uuid;
  v_owner_id    uuid;

  -- Stable QR location ids
  v_qr_dock     uuid := '22222222-bbbb-cccc-dddd-000000000001';
  v_qr_floor    uuid := '22222222-bbbb-cccc-dddd-000000000002';
  v_qr_warehouse uuid := '22222222-bbbb-cccc-dddd-000000000003';
  v_qr_shop     uuid := '22222222-bbbb-cccc-dddd-000000000004';

  -- Stable observation ids (deterministic for re-runs)
  v_obs_1  uuid := '22222222-bbbb-cccc-eeee-000000000001'; -- unsafe_act, high, open
  v_obs_2  uuid := '22222222-bbbb-cccc-eeee-000000000002'; -- unsafe_condition, high, in_progress
  v_obs_3  uuid := '22222222-bbbb-cccc-eeee-000000000003'; -- safe_behavior
  v_obs_4  uuid := '22222222-bbbb-cccc-eeee-000000000004'; -- anonymous unsafe_condition
  v_obs_5  uuid := '22222222-bbbb-cccc-eeee-000000000005'; -- unsafe_act, medium, closed
  v_obs_6  uuid := '22222222-bbbb-cccc-eeee-000000000006'; -- safe_behavior
  v_obs_7  uuid := '22222222-bbbb-cccc-eeee-000000000007'; -- unsafe_condition, low, closed
  v_obs_8  uuid := '22222222-bbbb-cccc-eeee-000000000008'; -- unsafe_act, medium, open with ABC
begin
  -- ── Resolve the demo tenant ──────────────────────────────────────────
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;

  if v_tenant_id is null then
    raise notice '[seed_bbs_demo] No is_demo=true tenant found — flag a tenant as demo before re-running.';
    return;
  end if;

  -- ── Resolve a member to act as the "reporter" ────────────────────────
  select tm.user_id into v_owner_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
   order by case tm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
            tm.created_at asc
   limit 1;

  if v_owner_id is null then
    raise notice '[seed_bbs_demo] No tenant_memberships on demo tenant — add a user before re-running.';
    return;
  end if;

  -- ── 1. QR Locations ──────────────────────────────────────────────────
  insert into public.bbs_qr_locations (id, tenant_id, name, area, description, token, active, created_by, updated_by)
  values
    (v_qr_dock,      v_tenant_id, 'Loading Dock A',      'Shipping',    'Forklift staging + truck bays 1-4',
     'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1', true, v_owner_id, v_owner_id),
    (v_qr_floor,     v_tenant_id, 'Production Floor',    'Manufacturing', 'Main packaging line, mixers, conveyors',
     'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', true, v_owner_id, v_owner_id),
    (v_qr_warehouse, v_tenant_id, 'Warehouse Aisle 3',   'Warehouse',   'Pallet racking — high-bay storage',
     'b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3', true, v_owner_id, v_owner_id),
    (v_qr_shop,      v_tenant_id, 'Maintenance Shop',    'Maintenance', 'Welding bay, tool crib, parts washer',
     'b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4', true, v_owner_id, v_owner_id)
  on conflict (id) do nothing;

  -- ── 2. Observations ──────────────────────────────────────────────────
  -- Each insert specifies created_at to anchor the report_number year
  -- and the time-ago timeline. Triggers fill report_number, risk_score,
  -- points_awarded, anonymous flag.

  -- (1) Unsafe act, high risk, open. Top-of-list.
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

  -- (2) Unsafe condition, high risk, in_progress. Has corrective action.
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

  -- (3) Safe behavior. Low-noise positive observation.
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

  -- (4) Anonymous QR submission, unsafe condition.
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

  -- (5) Unsafe act, medium risk, closed.
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

  -- (6) Safe behavior — peer recognition.
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

  -- (7) Unsafe condition, low risk, closed quickly.
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

  -- (8) Unsafe act, medium risk, open, with ABC analysis filled in.
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

  -- ── 3. Timeline actions for a couple observations ────────────────────
  insert into public.bbs_observation_actions (tenant_id, observation_id, action_type, body, created_at, created_by)
  select v_tenant_id, v_obs_2, 'comment',
         'Engineering quote received — replacement upright on order, ETA 3 business days.',
         now() - interval '18 hours', v_owner_id
  where not exists (
    select 1 from public.bbs_observation_actions
     where observation_id = v_obs_2 and action_type = 'comment'
       and body like 'Engineering quote received%'
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

  raise notice '[seed_bbs_demo] Seeded BBS demo data on tenant % (reporter %)', v_tenant_id, v_owner_id;
end $$;
