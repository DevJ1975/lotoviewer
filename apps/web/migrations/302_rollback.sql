-- Rollback for migration 302 (Phase 1.1 audit fixes).
--
-- Lost: every recorded policy communication and responsibility assignment,
-- each aspect's control or influence, and each scope version's control and
-- influence statement and exclusions. Export them first if they matter.
--
-- Revert the code that reads these columns and tables before running this.
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

drop table if exists public.ms_responsibilities;
drop table if exists public.ms_policy_communications;
alter table public.ms_policies drop constraint if exists ms_policies_tenant_id_id_discipline_key;

alter table public.ms_scope_statements
  drop column if exists exclusions,
  drop column if exists control_and_influence;

-- A view column cannot be dropped in place, so 297's definition is restored whole.
drop view if exists public.environmental_aspect_register;
create view public.environmental_aspect_register
with (security_invoker = true) as
select a.id, a.tenant_id, a.facility_id, a.activity, a.aspect, a.impact, a.process_area,
       a.life_cycle_stage, a.flow, a.controls, a.related_risk_id, a.source_reference, a.status,
       a.owner_user_id, a.notes, a.obsolete_at, a.obsolete_reason, a.last_reviewed_at, a.reviewed_by,
       a.next_review_due, a.created_by, a.updated_by, a.created_at, a.updated_at,
       coalesce(s.significant, false)       as significant,
       s.max_score,
       coalesce(s.current_scores, '[]'::jsonb) as current_scores
  from public.environmental_aspects a
  left join lateral (
    select bool_or(c.significant) as significant,
           max(c.score)           as max_score,
           jsonb_agg(jsonb_build_object(
               'operating_condition', c.operating_condition,
               'severity',            c.severity,
               'likelihood',          c.likelihood,
               'score',               c.score,
               'significant',         c.significant,
               'method_id',           c.method_id,
               'scored_at',           c.scored_at)
             order by array_position(array['normal','abnormal','emergency'], c.operating_condition)
           ) as current_scores
      from public.environmental_aspect_current_scores c
     where c.tenant_id = a.tenant_id and c.aspect_id = a.id
  ) s on true;

alter table public.environmental_aspects drop column if exists control_level;

notify pgrst, 'reload schema';

commit;
