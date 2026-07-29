-- Migration 252: give the regulatory-updates feed a jurisdiction dimension.
--
-- Migration 232 created osha_regulation_updates as a deliberately global
-- table, and said why in its own comment: "federal OSHA regulations are
-- identical for every tenant". That holds for federal OSHA. It does not hold
-- once Cal/OSHA is in the feed — Title 8 rulemaking binds a tenant with a
-- California site and is noise for everyone else.
--
-- So the table stays global (one shared row per update, still no tenant_id —
-- the *content* really is the same for everyone) and gains a jurisdiction
-- column. Filtering happens on read, against the states the tenant actually
-- operates in, rather than by duplicating rows per tenant.
--
-- 'federal' is the backfill and the default: every row written before this
-- migration came from the Federal Register fetch in the osha-reg-watch cron.
--
-- Idempotent.

begin;

alter table public.osha_regulation_updates
  add column if not exists jurisdiction text not null default 'federal';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'osha_regulation_updates_jurisdiction_chk'
  ) then
    alter table public.osha_regulation_updates
      add constraint osha_regulation_updates_jurisdiction_chk
      check (jurisdiction in ('federal', 'CA'));
  end if;
end $$;

comment on column public.osha_regulation_updates.jurisdiction is
  'Which regulator issued this update: federal (OSHA, via the Federal Register API) or CA (Cal/OSHA Standards Board / DIR). Read paths filter on it so a tenant with no California site never sees Title 8 items.';

-- The Coming Up panel reads forward-looking rows filtered by jurisdiction and
-- ordered by the soonest date that matters. Index the jurisdiction + upcoming
-- pair; the date ordering is finished in memory over a small result set, which
-- keeps this index usable by the existing feed query too.
create index if not exists idx_osha_reg_updates_jurisdiction_upcoming
  on public.osha_regulation_updates (jurisdiction, is_upcoming desc, effective_date nulls last);

notify pgrst, 'reload schema';

commit;
