-- Rollback for migration 297 (per-condition aspect scoring, expand half).
--
-- Roll back 301 first if it has run: 301 drops the legacy score columns
-- this rollback relies on. With 301 not applied, the legacy columns still
-- hold each aspect's original single score, so nothing is lost except
-- scores added after 297 (extra conditions, re-scores) and aspect links.
-- An aspect the Phase 1 API created has no legacy score: it takes its
-- highest current score, or migration 204's defaults (normal, 1 x 1) if
-- it was never scored, because the old model cannot say "not scored".
--
-- Apply: paste into the SQL Editor, or run with psql.
-- ────────────────────────────────────────────────────────────────────────────

begin;

update public.environmental_aspects a
   set operating_condition = coalesce(top.operating_condition, 'normal'),
       -- coalesce before least(): least() ignores nulls, so least(null, 5) is 5.
       severity            = least(coalesce(top.severity, 1), 5),
       likelihood          = least(coalesce(top.likelihood, 1), 5)
  from public.environmental_aspects self
  left join (
    select distinct on (c.aspect_id) c.aspect_id, c.operating_condition, c.severity, c.likelihood
      from public.environmental_aspect_current_scores c
     order by c.aspect_id, c.score desc,
              array_position(array['normal','abnormal','emergency'], c.operating_condition)
  ) top on top.aspect_id = self.id
 where self.id = a.id and a.severity is null;

alter table public.environmental_aspects
  alter column operating_condition set default 'normal',
  alter column operating_condition set not null,
  alter column severity set default 1,
  alter column severity set not null,
  alter column likelihood set default 1,
  alter column likelihood set not null;

drop view  if exists public.environmental_aspect_register;
drop view  if exists public.environmental_aspect_current_scores;
drop view  if exists public.environmental_aspect_score_history;
drop table if exists public.environmental_aspect_obligations;
drop table if exists public.environmental_aspect_scores;
drop function if exists public.environmental_aspect_scores_in_scale();

-- Restore migration 204's policy.
drop policy if exists environmental_aspects_tenant_scope on public.environmental_aspects;
create policy environmental_aspects_tenant_scope on public.environmental_aspects
  for all to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  with check (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin());

drop index if exists public.idx_environmental_aspects_active;
drop index if exists public.idx_environmental_aspects_facility;
alter table public.environmental_aspects
  drop constraint if exists environmental_aspects_tenant_id_id_key,
  drop constraint if exists environmental_aspects_obsolete_pair,
  drop column if exists facility_id,
  drop column if exists next_review_due,
  drop column if exists reviewed_by,
  drop column if exists last_reviewed_at,
  drop column if exists obsolete_reason,
  drop column if exists obsolete_at,
  drop column if exists process_area;

notify pgrst, 'reload schema';

commit;
