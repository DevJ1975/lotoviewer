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
--                           Nullable — see the note above the ALTER below.
--
-- Safe to apply BEFORE the code that writes these columns ships. That
-- ordering matters here: this repo has no automated migrate step, so the
-- migration and the deploy are two separate human actions and either can land
-- first. Nothing in this file makes an existing INSERT or SELECT fail.
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

-- Backfill before the constraints go on, so the NOT NULL below has nothing
-- left to reject. Both columns are backfilled: existing rows get a real
-- window even though new rows may leave it NULL (see the note below), because
-- for history we know exactly what window applied.
update public.incident_severe_injury_reports
   set reporting_jurisdiction = 'federal'
 where reporting_jurisdiction is null;

update public.incident_severe_injury_reports
   set reporting_window_hours = case when trigger_type = 'fatality' then 8 else 24 end
 where reporting_window_hours is null;

-- Deliberately asymmetric, and the asymmetry is the point.
--
-- reporting_jurisdiction is NOT NULL with a default, so a writer that has
-- never heard of the column still produces a correct row: 'federal' is what
-- every pre-existing row was tracked under.
--
-- reporting_window_hours is left NULLABLE. It cannot take a static default
-- because the right value depends on trigger_type (8 for a fatality, 24
-- otherwise, under federal). Defaulting it to 24 would stamp a fatality
-- inserted by an older deploy with a window the law does not give it — a
-- confidently wrong audit record, which is worse than an absent one. NOT NULL
-- without a default is worse still: it would make INSERTs from the currently
-- deployed app fail outright, breaking severe-injury reporting for the
-- length of the deploy window.
--
-- So NULL here means exactly one thing: "written by code that predated this
-- column." Every row the current app writes carries the real number, and
-- nothing reads this field for logic — it exists so an auditor can see which
-- window a filing was actually held to.
alter table public.incident_severe_injury_reports
  alter column reporting_jurisdiction set not null,
  alter column reporting_jurisdiction set default 'federal';

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
  'The window in hours that produced this row''s deadline, frozen at write time so a later rule or facility change never retroactively moves a past deadline. NULL means the row was written before this column existed; it is never inferred, because a guessed window is a wrong audit record.';

notify pgrst, 'reload schema';

commit;
