-- Migration 252: record which jurisdiction's reporting window a severe-injury
-- report was tracked under.
--
-- Migration 197 created incident_severe_injury_reports assuming federal
-- 29 CFR 1904.39 exclusively: 8 hours for a fatality, 24 for an in-patient
-- hospitalization, amputation, or loss of an eye. Cal/OSHA does not work that
-- way — Labor Code §6409.1(b) and 8 CCR §342 require reporting within 8 hours
-- for ALL FOUR triggers. A California establishment shown the federal window
-- is told it has 16 hours it does not have.
--
-- Two columns, both denormalized on purpose:
--
--   reporting_jurisdiction  Resolved at write time from the establishment's
--                           state. Stored rather than derived on read because
--                           a facility can be edited or re-pointed later, and
--                           a filing record must keep explaining the deadline
--                           it was actually held to. Same reasoning as
--                           loto_periodic_inspections.next_due_at.
--
--   reporting_window_hours  The window that produced the deadline. Redundant
--                           with (trigger_type, reporting_jurisdiction) today,
--                           but it is the audit-facing number: if either rule
--                           changes, historical rows must not silently
--                           re-compute to a deadline nobody was ever held to.
--
-- Backfill: every existing row predates this change and was tracked under the
-- federal window, so 'federal' is the truthful backfill value regardless of
-- where the establishment sits. Recomputing history against California would
-- retroactively mark past filings late for a deadline the product never
-- displayed.
--
-- Idempotent.

begin;

alter table public.incident_severe_injury_reports
  add column if not exists reporting_jurisdiction text,
  add column if not exists reporting_window_hours int;

-- Backfill before adding the constraints, so the NOT NULLs can be enforced.
update public.incident_severe_injury_reports
   set reporting_jurisdiction = 'federal'
 where reporting_jurisdiction is null;

update public.incident_severe_injury_reports
   set reporting_window_hours = case when trigger_type = 'fatality' then 8 else 24 end
 where reporting_window_hours is null;

alter table public.incident_severe_injury_reports
  alter column reporting_jurisdiction set not null,
  alter column reporting_jurisdiction set default 'federal',
  alter column reporting_window_hours set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'incident_severe_injury_reports_jurisdiction_chk'
  ) then
    alter table public.incident_severe_injury_reports
      add constraint incident_severe_injury_reports_jurisdiction_chk
      check (reporting_jurisdiction in ('federal', 'CA'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'incident_severe_injury_reports_window_chk'
  ) then
    alter table public.incident_severe_injury_reports
      add constraint incident_severe_injury_reports_window_chk
      check (reporting_window_hours in (8, 24));
  end if;
end $$;

comment on column public.incident_severe_injury_reports.reporting_jurisdiction is
  'Which agency''s reporting window governs this row: federal (29 CFR 1904.39, 8h fatality / 24h other) or CA (Lab. Code 6409.1(b) + 8 CCR 342, 8h for all four triggers). Resolved from the establishment state at write time and frozen thereafter.';

comment on column public.incident_severe_injury_reports.reporting_window_hours is
  'The window in hours that produced this row''s deadline. Frozen at write time so a later rule or facility change never retroactively moves a past deadline.';

notify pgrst, 'reload schema';

commit;
