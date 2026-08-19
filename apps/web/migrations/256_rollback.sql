-- Rollback for migration 256 (Predictive Safety Intelligence).
--
-- 256 is purely additive — four new tables, no column added to and no policy
-- changed on an existing one — so the rollback is a clean drop. Nothing else
-- references these tables.
--
-- DESTRUCTIVE. Dropping vision_hazard_signals discards human review decisions
-- (confirmed / dismissed) that cannot be recomputed: a re-run of the sweep
-- reproduces the signals but not the judgements a person made about them.
-- Export before running this if any signal has been reviewed.
--
-- Order matters: vision_sweep_photos and vision_hazard_signals both reference
-- vision_sweep_runs.
--
-- Idempotent.

begin;

drop table if exists public.vision_sweep_photos;
drop table if exists public.vision_hazard_signals;
drop table if exists public.vision_sweep_runs;
drop table if exists public.document_drafts;

notify pgrst, 'reload schema';

commit;
