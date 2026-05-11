-- Migration 120: STRIKE source support for Equipment Readiness.
--
-- Lets tenants require STRIKE refreshers before operating specific
-- equipment or equipment families. Source IDs point to loto_equipment.id
-- when the requirement is asset-specific; NULL source_id can represent
-- tenant/site-wide requirements, optionally narrowed by hazard_category
-- to the equipment_family value.

begin;

alter table public.strike_training_requirements
  drop constraint if exists strike_training_requirements_source_type_check;
alter table public.strike_training_requirements
  add constraint strike_training_requirements_source_type_check
  check (source_type in (
    'loto',
    'confined_space',
    'hot_work',
    'jha',
    'chemical',
    'bbs',
    'incident',
    'incident_action',
    'safety_board',
    'manual',
    'equipment_readiness',
    'custom'
  ));

alter table public.strike_task_checks
  drop constraint if exists strike_task_checks_source_type_check;
alter table public.strike_task_checks
  add constraint strike_task_checks_source_type_check
  check (source_type in (
    'loto',
    'confined_space',
    'hot_work',
    'jha',
    'chemical',
    'bbs',
    'incident',
    'incident_action',
    'safety_board',
    'manual',
    'equipment_readiness',
    'custom'
  ));

notify pgrst, 'reload schema';

commit;
