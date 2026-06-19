-- Migration 239: add 'hazard_hunt' to the risks.source discriminator.
--
-- The risk register already supports cross-module escalation via the soft-FK
-- pattern (risks.source + risks.source_ref_id, migration 037). Hazard Hunt
-- findings escalate the same way. Adding a dedicated 'hazard_hunt' source value
-- (rather than reusing 'inspection') lets the EHS-score gather query and the
-- register filters distinguish hazard-hunt-sourced risks cheaply and
-- unambiguously.
--
-- Idempotent: drops and recreates the column CHECK with the extra value.

begin;

alter table public.risks drop constraint if exists risks_source_check;
alter table public.risks add constraint risks_source_check
  check (source in (
    'inspection','jsa','incident','worker_report','audit','moc','other','hazard_hunt'));

notify pgrst, 'reload schema';

commit;
