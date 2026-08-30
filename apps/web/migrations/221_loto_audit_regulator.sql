-- Migration 221: LOTO audit — Cal/OSHA Regulator review phase.
--
-- A veteran Cal/OSHA compliance officer (CSHO) adversarially re-reviews the
-- internal audit AFTER it runs and BEFORE human review. Two outputs, both
-- DATA-ONLY (no new RPC, no agent CHECK change): the per-machine critique and a
-- program-level report. Corrections it drives reuse the existing apply path —
-- the regulator merely sharpens the EHS findings + procedure draft already
-- staged by the audit (agent='EHS' / 'SSD'), so no new change_kind or agent code
-- is needed.
--
-- This migration only adds nullable JSONB/boolean columns to hold the staged
-- critique + report:
--   - loto_audit_runs.regulator_report          — the program-level result.
--   - loto_audit_equipment_results.regulator_payload — the per-machine result.
--   - loto_audit_equipment_results.regulator_concurs — the concur/dissent flag,
--     also the per-machine resume marker for the regulator phase (its presence,
--     via regulator_payload, means the machine was already reviewed).
--
-- Idempotent: every add is `if not exists`.

begin;

alter table public.loto_audit_runs
  add column if not exists regulator_report jsonb;

alter table public.loto_audit_equipment_results
  add column if not exists regulator_payload jsonb,
  add column if not exists regulator_concurs boolean;

notify pgrst, 'reload schema';

commit;
