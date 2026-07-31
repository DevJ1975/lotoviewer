-- Migration 256: seed_wls_equipment_readiness_demo() — so "Reset Demo"
-- restores Equipment Readiness instead of emptying it.
--
-- WHY THIS EXISTS
-- ───────────────
-- Reset Demo deletes equipment_inspections, equipment_inspection_responses,
-- equipment_defects, equipment_repairs and equipment_evidence, and no seed
-- function put any of them back. Every reset silently emptied the whole
-- module and left it empty. This is the same defect migration 200 fixed for
-- BBS, one module later.
--
-- THE FLEET
-- ─────────
-- seed_wls_demo() (migration 030) seeds twelve *fixed plant* assets —
-- conveyors, a fryer, a boiler. Equipment Readiness is a pre-use check for
-- *mobile* equipment, so none of them are a credible subject: a pre-use
-- inspection on a boiler reads as nonsense. This seed adds five mobile units
-- whose families match the operator authorizations already seeded by
-- migration 119 (forklift_electric, pallet_jack_powered, aerial_lift_scissor),
-- so Worker Readiness and Equipment Readiness describe one site rather than
-- two unrelated fixtures.
--
-- Checklist templates and items are NOT invented here — they come from
-- migration 122, which publishes a global template per family. This seed
-- resolves them by family and answers their real items.
--
-- THE PICTURE IT PAINTS
-- ─────────────────────
--   FORK-01  available                      ready       clean inspection today
--   FORK-02  limited_use                    limited_use LPG mount, repair soon
--   REACH-01 out_of_service_pending_review   blocked     mast drift, critical
--   PJACK-01 available                      ready       defect found, repaired
--   SCIS-01  inspection_due                 ready       last checked 9 days ago
--
-- Three open defects (one per severity), one resolved, two repairs — one
-- in flight, one returned to service. Enough for the dashboard tiles, the
-- defect queue and the equipment detail panel to all have something to say.
--
-- TENANT ID IS PASSED EXPLICITLY
-- ──────────────────────────────
-- Every tenant-scoped table defaults tenant_id to public.active_tenant_id(),
-- which reads the x-active-tenant request header. Applied from psql or the
-- SQL editor that header does not exist, the default resolves to NULL, and
-- the insert dies on NOT NULL. Resolve the tenant and pass it.
--
-- IDEMPOTENT — deterministic ids and NOT EXISTS guards, so re-runs add
-- nothing. Readiness status is re-asserted by an explicit UPDATE rather than
-- left to the insert, so a reset also *restores* a unit someone returned to
-- service by hand during a demo.

begin;

create or replace function public.seed_wls_equipment_readiness_demo()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id   uuid;
  v_operator_id uuid;  -- submits the inspections
  v_mechanic_id uuid;  -- owns the repairs and the return to service

  -- Global checklist templates, resolved by family (migration 122).
  v_tpl_fork_e  uuid;
  v_tpl_fork_ic uuid;
  v_tpl_reach   uuid;
  v_tpl_pjack   uuid;
  v_tpl_scissor uuid;

  -- Fleet.
  v_eq_fork_e   uuid;
  v_eq_fork_ic  uuid;
  v_eq_reach    uuid;
  v_eq_pjack    uuid;
  v_eq_scissor  uuid;

  -- Inspections.
  v_insp_fork_e  uuid := 'ee111111-aaaa-bbbb-dddd-000000000001';
  v_insp_fork_ic uuid := 'ee111111-aaaa-bbbb-dddd-000000000002';
  v_insp_reach   uuid := 'ee111111-aaaa-bbbb-dddd-000000000003';
  v_insp_pjack   uuid := 'ee111111-aaaa-bbbb-dddd-000000000004';
  v_insp_scissor uuid := 'ee111111-aaaa-bbbb-dddd-000000000005';

  -- Defects.
  v_def_mast    uuid := 'ee111111-aaaa-bbbb-eeee-000000000001';
  v_def_lpg     uuid := 'ee111111-aaaa-bbbb-eeee-000000000002';
  v_def_rail    uuid := 'ee111111-aaaa-bbbb-eeee-000000000003';
  v_def_wheel   uuid := 'ee111111-aaaa-bbbb-eeee-000000000004';

  -- Repairs.
  v_rep_mast    uuid := 'ee111111-aaaa-bbbb-ffff-000000000001';
  v_rep_wheel   uuid := 'ee111111-aaaa-bbbb-ffff-000000000002';

  -- Inspections that should read as "today" on the dashboard tile, without
  -- landing in the future when the reset runs before 07:00 local.
  v_today_am timestamptz := least(date_trunc('day', now()) + interval '7 hours', now());
  v_today_pm timestamptz := least(date_trunc('day', now()) + interval '13 hours', now());

  -- Resulting state, not insert deltas: a re-run inserts nothing, and
  -- "0 inspections" would read as a failure rather than a no-op.
  v_units       int;
  v_inspections int;
  v_defects     int;
  v_repairs     int;
begin
  -- ── Resolve the demo tenant ──────────────────────────────────────────
  select id into v_tenant_id
    from public.tenants
   where coalesce(is_demo, false) = true
   order by created_at asc
   limit 1;
  if v_tenant_id is null then
    return '[seed_wls_equipment_readiness_demo] skipped — no is_demo=true tenant';
  end if;

  -- ── Resolve two actors on this tenant ────────────────────────────────
  select tm.user_id into v_operator_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id
   order by tm.created_at asc
   limit 1;
  if v_operator_id is null then
    return '[seed_wls_equipment_readiness_demo] skipped — no tenant_memberships on demo tenant';
  end if;

  select tm.user_id into v_mechanic_id
    from public.tenant_memberships tm
   where tm.tenant_id = v_tenant_id and tm.user_id <> v_operator_id
   order by tm.created_at asc
   limit 1;
  if v_mechanic_id is null then v_mechanic_id := v_operator_id; end if;

  -- ── Resolve the global checklist templates ───────────────────────────
  -- Highest published version per family. Missing templates mean migration
  -- 122 has not been applied; seeding inspections against nothing would
  -- produce answer-less checklists, so stop and say why.
  select id into v_tpl_fork_e  from public.equipment_checklist_templates
   where library_scope = 'global' and status = 'published' and equipment_family = 'forklift_electric'
   order by version_number desc limit 1;
  select id into v_tpl_fork_ic from public.equipment_checklist_templates
   where library_scope = 'global' and status = 'published' and equipment_family = 'forklift_ic_lpg'
   order by version_number desc limit 1;
  select id into v_tpl_reach   from public.equipment_checklist_templates
   where library_scope = 'global' and status = 'published' and equipment_family = 'reach_truck'
   order by version_number desc limit 1;
  select id into v_tpl_pjack   from public.equipment_checklist_templates
   where library_scope = 'global' and status = 'published' and equipment_family = 'pallet_jack_powered'
   order by version_number desc limit 1;
  select id into v_tpl_scissor from public.equipment_checklist_templates
   where library_scope = 'global' and status = 'published' and equipment_family = 'aerial_lift_scissor'
   order by version_number desc limit 1;

  if v_tpl_fork_e is null or v_tpl_fork_ic is null or v_tpl_reach is null
     or v_tpl_pjack is null or v_tpl_scissor is null then
    return '[seed_wls_equipment_readiness_demo] skipped — global checklist templates missing; apply migration 122 first';
  end if;

  -- ── 1. Mobile fleet ──────────────────────────────────────────────────
  -- Guarded on equipment_id, the natural key, so a hand-added unit with the
  -- same tag is never duplicated. Ids are resolved afterwards rather than
  -- assumed, for the same reason.
  insert into public.loto_equipment
    (equipment_id, tenant_id, description, department, prefix, photo_status,
     has_equip_photo, has_iso_photo, decommissioned, verified, equipment_family)
  select f.equipment_id, v_tenant_id, f.description, f.department, 'DEMO', 'missing',
         false, false, false, false, f.equipment_family
    from (values
      ('DEMO-PIT-FORK-01',  'Electric forklift — 5,000 lb cushion tire',     'Distribution', 'forklift_electric'),
      ('DEMO-PIT-FORK-02',  'LPG forklift — 6,000 lb pneumatic tire',        'Distribution', 'forklift_ic_lpg'),
      ('DEMO-PIT-REACH-01', 'Reach truck — narrow aisle, 24 ft mast',        'Distribution', 'reach_truck'),
      ('DEMO-PIT-PJACK-01', 'Powered pallet jack — walkie, 4,500 lb',        'Packaging',    'pallet_jack_powered'),
      ('DEMO-PIT-SCIS-01',  'Scissor lift — 26 ft electric, slab',           'Maintenance',  'aerial_lift_scissor')
    ) as f(equipment_id, description, department, equipment_family)
   where not exists (
     select 1 from public.loto_equipment e where e.equipment_id = f.equipment_id
   );

  select id into v_eq_fork_e  from public.loto_equipment where equipment_id = 'DEMO-PIT-FORK-01'  and tenant_id = v_tenant_id;
  select id into v_eq_fork_ic from public.loto_equipment where equipment_id = 'DEMO-PIT-FORK-02'  and tenant_id = v_tenant_id;
  select id into v_eq_reach   from public.loto_equipment where equipment_id = 'DEMO-PIT-REACH-01' and tenant_id = v_tenant_id;
  select id into v_eq_pjack   from public.loto_equipment where equipment_id = 'DEMO-PIT-PJACK-01' and tenant_id = v_tenant_id;
  select id into v_eq_scissor from public.loto_equipment where equipment_id = 'DEMO-PIT-SCIS-01'  and tenant_id = v_tenant_id;

  if v_eq_fork_e is null or v_eq_fork_ic is null or v_eq_reach is null
     or v_eq_pjack is null or v_eq_scissor is null then
    return '[seed_wls_equipment_readiness_demo] skipped — a DEMO-PIT-* tag exists on another tenant';
  end if;

  -- ── 2. Inspections ───────────────────────────────────────────────────
  -- failed_item_count / failed_critical_count are stated here and made true
  -- by section 3, which fails exactly one item per flagged inspection.
  insert into public.equipment_inspections
    (id, tenant_id, equipment_record_id, equipment_id, checklist_template_id, operator_id,
     started_at, submitted_at, duration_seconds, shift_label, hour_meter, location_label,
     readiness_result, failed_critical_count, failed_item_count,
     operator_attestation, signature_name)
  select i.id, v_tenant_id, i.equipment_record_id, i.equipment_tag, i.template_id, v_operator_id,
         i.submitted_at - make_interval(secs => i.duration_seconds), i.submitted_at,
         i.duration_seconds, i.shift_label, i.hour_meter, i.location_label,
         i.readiness_result, i.failed_critical, i.failed_items, true, 'Morgan Lee'
    from (values
      (v_insp_fork_e,  v_eq_fork_e,  'DEMO-PIT-FORK-01',  v_tpl_fork_e,  v_today_am,                  186, 'Day',   1842.5, 'Distribution — charging bay 3', 'ready',       0, 0),
      (v_insp_fork_ic, v_eq_fork_ic, 'DEMO-PIT-FORK-02',  v_tpl_fork_ic, v_today_am,                  241, 'Day',   2210.0, 'Distribution — yard ramp',      'limited_use', 1, 1),
      (v_insp_reach,   v_eq_reach,   'DEMO-PIT-REACH-01', v_tpl_reach,   now() - interval '26 hours', 302, 'Night', 3477.0, 'Distribution — aisle 12',       'blocked',     1, 1),
      (v_insp_pjack,   v_eq_pjack,   'DEMO-PIT-PJACK-01', v_tpl_pjack,   v_today_pm,                  128, 'Day',    905.0, 'Packaging — line A staging',    'ready',       0, 0),
      (v_insp_scissor, v_eq_scissor, 'DEMO-PIT-SCIS-01',  v_tpl_scissor, now() - interval '9 days',   214, 'Day',    612.0, 'Maintenance — admin roof access', 'ready',     0, 0)
    ) as i(id, equipment_record_id, equipment_tag, template_id, submitted_at, duration_seconds,
           shift_label, hour_meter, location_label, readiness_result, failed_critical, failed_items)
   where not exists (
     select 1 from public.equipment_inspections x where x.id = i.id
   );

  -- ── 3. Responses ─────────────────────────────────────────────────────
  -- Every item on the inspection's template gets an answer. Only
  -- pass_fail_na items carry a judgement; every other prompt answers as its
  -- own type (the response check constraint is a superset of response_type).
  -- Judgement is "pass", except in the one section named by fail_section —
  -- each of which holds exactly one item, so the failure counts on the
  -- inspection rows above are exact.
  insert into public.equipment_inspection_responses
    (tenant_id, inspection_id, item_id, response, numeric_value, notes, severity, action_decision)
  select v_tenant_id, p.inspection_id, it.id,
         case
           when it.response_type <> 'pass_fail_na' then it.response_type
           when it.section = p.fail_section        then 'fail'
           else 'pass'
         end,
         case when it.response_type = 'number' then p.hour_meter else null end,
         case when it.section = p.fail_section then p.fail_note     else null end,
         case when it.section = p.fail_section then p.fail_severity else null end,
         case when it.section = p.fail_section then p.fail_decision else null end
    from (values
      (v_insp_fork_e,  v_tpl_fork_e,  null::text,             null::text, null::text, null::text, 1842.5::numeric),
      (v_insp_fork_ic, v_tpl_fork_ic, 'Power source',
       'LPG cylinder mount strap frayed at the buckle; cylinder seated and valve orientation correct.',
       'repair_soon', 'limited_use', 2210.0),
      (v_insp_reach,   v_tpl_reach,   'Mast/reach system',
       'Reach carriage drifts down roughly 4 in over 30 s under load. Removed from service pending hydraulic repair.',
       'critical', 'remove_from_service', 3477.0),
      (v_insp_pjack,   v_tpl_pjack,   null, null, null, null, 905.0),
      (v_insp_scissor, v_tpl_scissor, null, null, null, null, 612.0)
    ) as p(inspection_id, template_id, fail_section, fail_note, fail_severity, fail_decision, hour_meter)
    join public.equipment_checklist_items it on it.template_id = p.template_id
   where not exists (
     select 1 from public.equipment_inspection_responses r
      where r.inspection_id = p.inspection_id and r.item_id = it.id
   );

  -- ── 4. Defects ───────────────────────────────────────────────────────
  -- One per severity open, plus one already resolved so the queue shows a
  -- closed loop rather than only a backlog.
  insert into public.equipment_defects
    (id, tenant_id, equipment_record_id, inspection_id, component, severity, status,
     out_of_service, description, first_seen_at, last_seen_at, assigned_to, due_at, created_by)
  select d.id, v_tenant_id, d.equipment_record_id, d.inspection_id, d.component, d.severity, d.status,
         d.out_of_service, d.description, d.first_seen_at, d.last_seen_at, v_mechanic_id, d.due_at, v_operator_id
    from (values
      (v_def_mast, v_eq_reach, v_insp_reach, 'Mast / reach carriage', 'critical', 'in_repair', true,
       'Reach carriage drifts under load — approx. 4 in over 30 s. Suspected leaking lift cylinder seal. Unit tagged out.',
       now() - interval '26 hours', now() - interval '26 hours', now() + interval '2 days'),
      (v_def_lpg, v_eq_fork_ic, v_insp_fork_ic, 'LPG cylinder mount', 'repair_soon', 'acknowledged', false,
       'Cylinder restraint strap frayed at the buckle. Cleared for limited use on smooth floor only until the strap is replaced.',
       v_today_am, v_today_am, now() + interval '7 days'),
      (v_def_rail, v_eq_scissor, null::uuid, 'Platform guardrail chain', 'monitor', 'open', false,
       'Entry chain hook is bent and does not seat square. Gate still latches; scheduled with the next PM.',
       now() - interval '9 days', now() - interval '9 days', now() + interval '21 days'),
      (v_def_wheel, v_eq_pjack, null::uuid, 'Load wheel', 'repair_soon', 'resolved', false,
       'Right load wheel flat-spotted, dragging on turns. Replaced and returned to service.',
       now() - interval '12 days', now() - interval '9 days', now() - interval '8 days')
    ) as d(id, equipment_record_id, inspection_id, component, severity, status, out_of_service,
           description, first_seen_at, last_seen_at, due_at)
   where not exists (
     select 1 from public.equipment_defects x where x.id = d.id
   );

  -- ── 5. Repairs ───────────────────────────────────────────────────────
  insert into public.equipment_repairs
    (id, tenant_id, defect_id, status, repair_notes, mechanic_id,
     completed_at, return_to_service_by, return_to_service_at, return_to_service_notes)
  select r.id, v_tenant_id, r.defect_id, r.status, r.repair_notes, v_mechanic_id,
         r.completed_at, r.rts_by, r.rts_at, r.rts_notes
    from (values
      (v_rep_mast, v_def_mast, 'in_repair',
       'Lift cylinder seal kit on order. Unit remains tagged out of service; do not return until drift test passes.',
       null::timestamptz, null::uuid, null::timestamptz, null::text),
      (v_rep_wheel, v_def_wheel, 'returned_to_service',
       'Load wheel and bearing replaced, tandem checked for wear. Function-tested loaded and unloaded.',
       now() - interval '9 days', v_mechanic_id, now() - interval '9 days',
       'Drift and steering checks passed. Returned to Packaging line A staging.')
    ) as r(id, defect_id, status, repair_notes, completed_at, rts_by, rts_at, rts_notes)
   where not exists (
     select 1 from public.equipment_repairs x where x.id = r.id
   );

  -- ── 6. Evidence ──────────────────────────────────────────────────────
  -- storage_path is NOT NULL and points into the `equipment-evidence`
  -- bucket. These paths are placeholders under demo-seed/ — no object is
  -- uploaded, and none is needed: the only consumer renders evidence_kind
  -- as a text chip (components/equipment/EquipmentReadinessPanel.tsx). If a
  -- gallery is ever added here, upload real objects or drop these rows.
  insert into public.equipment_evidence
    (id, tenant_id, source_type, source_id, equipment_record_id, storage_path,
     evidence_kind, caption, component, uploaded_by, captured_at)
  select e.id, v_tenant_id, e.source_type, e.source_id, e.equipment_record_id,
         format('demo-seed/%s/%s.jpg', v_tenant_id, e.id), e.evidence_kind, e.caption,
         e.component, v_operator_id, e.captured_at
    from (values
      ('ee111111-aaaa-cccc-dddd-000000000001'::uuid, 'inspection', v_insp_fork_e, v_eq_fork_e,
       'equipment_full_view', 'Pre-use full view — electric forklift, charging bay 3', null::text, v_today_am),
      ('ee111111-aaaa-cccc-dddd-000000000002'::uuid, 'inspection', v_insp_fork_e, v_eq_fork_e,
       'hour_meter', 'Hour meter reading 1842.5', null, v_today_am),
      ('ee111111-aaaa-cccc-dddd-000000000003'::uuid, 'inspection', v_insp_reach, v_eq_reach,
       'damage', 'Reach carriage at rest vs. 30 s under load', 'Mast / reach carriage', now() - interval '26 hours'),
      ('ee111111-aaaa-cccc-dddd-000000000004'::uuid, 'defect', v_def_mast, v_eq_reach,
       'defect', 'Weep at lift cylinder rod seal', 'Mast / reach carriage', now() - interval '25 hours'),
      ('ee111111-aaaa-cccc-dddd-000000000005'::uuid, 'repair', v_rep_wheel, v_eq_pjack,
       'repair', 'Replacement load wheel fitted', 'Load wheel', now() - interval '9 days')
    ) as e(id, source_type, source_id, equipment_record_id, evidence_kind, caption, component, captured_at)
   where not exists (
     select 1 from public.equipment_evidence x where x.id = e.id
   );

  -- ── 7. Readiness status on the fleet ─────────────────────────────────
  -- An UPDATE rather than insert defaults, so a reset also restores a unit
  -- that was returned to service by hand mid-demo. SCIS-01 is deliberately
  -- left inspection_due: its last check was nine days ago, which is what a
  -- lapsed unit looks like.
  update public.loto_equipment e
     set readiness_status            = s.readiness_status,
         last_pre_use_inspection_at  = s.inspected_at,
         last_pre_use_inspection_id  = s.inspection_id
    from (values
      (v_eq_fork_e,  'available',                     v_today_am,                  v_insp_fork_e),
      (v_eq_fork_ic, 'limited_use',                   v_today_am,                  v_insp_fork_ic),
      (v_eq_reach,   'out_of_service_pending_review', now() - interval '26 hours', v_insp_reach),
      (v_eq_pjack,   'available',                     v_today_pm,                  v_insp_pjack),
      (v_eq_scissor, 'inspection_due',                now() - interval '9 days',   v_insp_scissor)
    ) as s(id, readiness_status, inspected_at, inspection_id)
   where e.id = s.id
     and e.tenant_id = v_tenant_id;

  select count(*) into v_units from public.loto_equipment
   where tenant_id = v_tenant_id and equipment_id like 'DEMO-PIT-%';
  select count(*) into v_inspections from public.equipment_inspections where tenant_id = v_tenant_id;
  select count(*) into v_defects     from public.equipment_defects     where tenant_id = v_tenant_id;
  select count(*) into v_repairs     from public.equipment_repairs     where tenant_id = v_tenant_id;

  return format(
    'Seeded WLS Equipment Readiness demo: %s mobile units, %s inspection(s), %s defect(s), %s repair(s) (tenant %s)',
    v_units, v_inspections, v_defects, v_repairs, v_tenant_id
  );
end;
$$;

-- Same hardening posture as migration 200: only the service_role used by
-- the reset route calls this.
revoke execute on function public.seed_wls_equipment_readiness_demo() from anon, authenticated, public;

-- Seed once on apply (safe + idempotent).
do $$
begin
  raise notice '%', public.seed_wls_equipment_readiness_demo();
end $$;

notify pgrst, 'reload schema';

commit;
