-- Migration 122: Repair and broaden Equipment Readiness starter checklists.
--
-- Migration 118 seeded checklist items only from templates newly inserted in
-- that same statement. If a database already had the global templates but no
-- items, re-running the migration could leave a published empty checklist.
-- This repair is intentionally idempotent: it ensures starter templates exist
-- for all supported Equipment Readiness families, then inserts missing prompts
-- for every published global template.

begin;

insert into public.equipment_checklist_templates
  (library_scope, equipment_family, title, version_number, osha_basis)
values
  ('global', 'forklift_electric', 'Electric forklift pre-use inspection', 1, 'OSHA 29 CFR 1910.178(q), 1910.178(l), OSHA PIT pre-operation guidance'),
  ('global', 'forklift_ic_lpg', 'Internal combustion/LPG forklift pre-use inspection', 1, 'OSHA 29 CFR 1910.178(q), 1910.178(l), OSHA PIT pre-operation guidance'),
  ('global', 'reach_truck', 'Reach truck pre-use inspection', 1, 'OSHA 29 CFR 1910.178(q), 1910.178(l), OSHA PIT pre-operation guidance'),
  ('global', 'order_picker', 'Order picker pre-use inspection', 1, 'OSHA 29 CFR 1910.178(q), 1910.178(l), fall protection and PIT pre-operation guidance'),
  ('global', 'pallet_jack_powered', 'Powered pallet jack/lifter pre-use inspection', 1, 'OSHA PIT pre-operation guidance and NIOSH daily inspection checklist'),
  ('global', 'pallet_lifter_manual', 'Manual pallet lifter pre-use inspection', 1, 'Manual material handling and employer pre-use readiness checklist'),
  ('global', 'aerial_lift_scissor', 'Scissor lift pre-start inspection', 1, 'OSHA aerial lift pre-start inspection and work-area hazard guidance'),
  ('global', 'aerial_lift_boom', 'Boom lift pre-start inspection', 1, 'OSHA aerial lift pre-start inspection and work-area hazard guidance'),
  ('global', 'tow_tractor', 'Tow tractor pre-use inspection', 1, 'OSHA PIT pre-operation guidance and employer mobile equipment checklist'),
  ('global', 'rough_terrain_forklift', 'Rough terrain forklift pre-use inspection', 1, 'OSHA PIT pre-operation guidance and rough-terrain work-area hazard guidance'),
  ('global', 'general', 'General mobile equipment pre-use inspection', 1, 'Employer pre-use readiness checklist')
on conflict do nothing;

with starter_items(family, section, prompt, response_type, required, critical, photo_required, sort_order, help_text) as (
  values
    ('all', 'Evidence', 'Capture a current full-view photo of this equipment.', 'photo_ack', true, false, true, 10, 'Use the equipment photo upload before submitting.'),
    ('all', 'Evidence', 'Record hour meter, odometer, or battery reading where available.', 'number', false, false, false, 20, null),
    ('all', 'Visual', 'No obvious leaks, cracked components, loose parts, or unsafe damage.', 'pass_fail_na', true, true, true, 30, 'Failing this item removes the equipment from service pending review.'),
    ('all', 'Visual', 'Tires/wheels, forks/platform, guards, labels, and data plate are present and serviceable.', 'pass_fail_na', true, true, true, 40, null),
    ('all', 'Controls', 'Horn, lights/alarms, steering, brakes, and emergency controls function as expected.', 'pass_fail_na', true, true, false, 50, null),
    ('forklift_electric', 'Power source', 'Battery, cables, connectors, restraint, and charging area are safe.', 'pass_fail_na', true, true, true, 60, null),
    ('forklift_ic_lpg', 'Power source', 'Fuel tank/cylinder, hoses, fittings, valve orientation, and leaks are safe.', 'pass_fail_na', true, true, true, 60, null),
    ('reach_truck', 'Mast/reach system', 'Mast, reach carriage, forks, chains, rollers, tilt, and side-shift are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('reach_truck', 'Travel path', 'Aisles, racking clearance, floor condition, and overhead obstructions are checked.', 'pass_fail_na', true, true, false, 70, null),
    ('order_picker', 'Platform/fall protection', 'Platform gate, guardrails, harness/lanyard anchorage, and lift controls are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('order_picker', 'Work area', 'Rack condition, aisle clearance, overhead obstructions, and travel path are checked.', 'pass_fail_na', true, true, false, 70, null),
    ('pallet_jack_powered', 'Lift system', 'Lift/lower controls, tiller, belly button, wheels, and battery are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('pallet_lifter_manual', 'Lift system', 'Handle, pump, release lever, forks, wheels, and load rating markings are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('aerial_lift_scissor', 'Lift system', 'Platform, gates/guardrails, emergency lowering, pothole protection, and safety devices are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('aerial_lift_scissor', 'Work area', 'Work area is checked for holes, slopes, overhead hazards, traffic, floor capacity, and weather/wind.', 'pass_fail_na', true, true, false, 70, null),
    ('aerial_lift_boom', 'Lift system', 'Boom, platform, gate, controls, emergency lowering, and anchor points are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('aerial_lift_boom', 'Work area', 'Work area is checked for holes, slopes, overhead hazards, power lines, traffic, ground conditions, and wind.', 'pass_fail_na', true, true, false, 70, null),
    ('tow_tractor', 'Tow system', 'Hitch/coupler, safety chains, drawbar, lights, brakes, steering, and travel alarm are serviceable.', 'pass_fail_na', true, true, true, 60, null),
    ('rough_terrain_forklift', 'Terrain/work area', 'Ground conditions, slopes, outriggers/stabilizers, tires, forks, mast/boom, and load chart are checked.', 'pass_fail_na', true, true, true, 60, null)
)
insert into public.equipment_checklist_items
  (template_id, section, prompt, response_type, required, critical, photo_required, sort_order, help_text)
select t.id, item.section, item.prompt, item.response_type, item.required, item.critical, item.photo_required, item.sort_order, item.help_text
  from public.equipment_checklist_templates t
  join starter_items item
    on item.family = 'all'
    or item.family = t.equipment_family
 where t.library_scope = 'global'
   and t.status = 'published'
   and not exists (
     select 1
       from public.equipment_checklist_items existing
      where existing.template_id = t.id
        and existing.prompt = item.prompt
   );

notify pgrst, 'reload schema';

commit;
