-- Rollback for migration 296 (scoring methods).
--
-- Roll back 297 first: environmental_aspect_scores references these
-- methods, so this rollback fails while 297 is in place.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop table if exists public.ms_scoring_methods;
drop function if exists public.ms_scoring_methods_frozen();
drop function if exists public.ms_method_score(jsonb, int, int);
drop function if exists public.ms_scoring_matrix_is_valid(jsonb, int, int);

notify pgrst, 'reload schema';

commit;
