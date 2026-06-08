-- Migration 217: regulation_update_checks — state for the regulation freshness cron.
--
-- The assistant's RAG corpus includes Federal OSHA 29 CFR Part 1910, ingested
-- offline via scripts/osha_1910_ingest.py (eCFR is too large + Voyage too slow to
-- ingest inside a Vercel function). eCFR amends Part 1910 a few times a year, so a
-- bi-monthly cron (/api/cron/check-regulation-updates) compares eCFR's latest
-- amendment date for the part against the snapshot we last ingested and emails the
-- operator when a re-ingest is due. This table is that single source of truth:
-- one row per tracked corpus.
--
-- Writes come from the cron (service role, bypasses RLS) and from the ingester's
-- record-snapshot.sql. Reads are superadmin-only (operators view it on a future
-- admin panel); no tenant ever needs it, so it carries no tenant_id.

begin;

create table if not exists public.regulation_update_checks (
  -- Stable key for the tracked corpus, e.g. 'osha-29-cfr-1910'.
  source             text primary key,
  title              text not null,
  -- eCFR title + part the cron polls (https://www.ecfr.gov/api/versioner/...).
  ecfr_title         text not null,
  ecfr_part          text not null,
  -- The eCFR snapshot date the corpus currently reflects (the ingester's --date).
  ingested_snapshot  date,
  ingested_at        timestamptz,
  -- Newest eCFR amendment date the cron has observed for the part.
  latest_amendment   date,
  -- True when latest_amendment is newer than ingested_snapshot (re-ingest due).
  needs_update       boolean not null default false,
  last_checked_at    timestamptz,
  last_notified_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.regulation_update_checks enable row level security;

drop policy if exists "regulation_update_checks_superadmin_all" on public.regulation_update_checks;
create policy "regulation_update_checks_superadmin_all" on public.regulation_update_checks
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- Seed the OSHA 1910 row so the cron has a baseline to update on its first run.
insert into public.regulation_update_checks (source, title, ecfr_title, ecfr_part)
values (
  'osha-29-cfr-1910',
  'Federal OSHA 29 CFR Part 1910 (General Industry)',
  '29',
  '1910'
)
on conflict (source) do nothing;

notify pgrst, 'reload schema';

commit;
