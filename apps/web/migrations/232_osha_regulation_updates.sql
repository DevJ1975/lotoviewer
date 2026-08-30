-- Migration 232: osha_regulation_updates — the OSHA Regulatory Watch feed.
--
-- The osha-reg-watch cron (/api/cron/osha-reg-watch, monthly) fetches
-- osha.gov, has Claude extract substantive regulation updates + upcoming
-- items, and writes one row per update here. The home-dashboard panel
-- (OshaRegWatchPanel) reads the latest rows. The feed is GLOBAL — federal
-- OSHA regulations are identical for every tenant — so the table carries no
-- tenant_id and every authenticated user reads the same rows.
--
-- Same RLS posture as prop65_chemicals (migration 170): authenticated read,
-- writes via the service-role cron (which bypasses RLS) or a superadmin.
--
-- Idempotent.

begin;

create table if not exists public.osha_regulation_updates (
  id                  uuid        primary key default gen_random_uuid(),
  -- Cron-derived idempotency key (sha1 of the source URL, or of title+date
  -- when no URL was recovered). Re-running the cron over an unchanged page
  -- collides here, making inserts idempotent. Never supplied by the model.
  dedup_key           text        not null unique,
  title               text        not null,
  -- AI-assigned bucket. Plain text (not a DB enum) so an unforeseen model
  -- value never fails an insert; the read helper validates softly.
  category            text        not null,
  -- True for proposed rules / open comment periods / not-yet-effective
  -- changes. Drives the panel's "Upcoming" badge + feed ordering.
  is_upcoming         boolean     not null default false,
  -- Deep link back to osha.gov (the panel's "view on OSHA" link).
  source_url          text        not null,
  published_date      date,
  effective_date      date,
  comment_close_date  date,
  -- The AI's plain-language workplace-impact summary — the panel's payload.
  impact_summary      text        not null,
  -- AI-assigned priority (high/medium/low); advisory only, never a gate.
  severity            text,
  -- Provenance: the model id that produced the summary.
  ai_model            text,
  fetched_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.osha_regulation_updates is
  'AI-summarized OSHA regulation updates + upcoming items. Global (no tenant_id); written by the osha-reg-watch cron, read by every tenant.';

-- Feed read path: upcoming items first, then most-recent first. Matches the
-- panel's order clause (is_upcoming desc, published_date desc nulls last,
-- created_at desc). All plain columns, so the expression stays IMMUTABLE.
create index if not exists idx_osha_reg_updates_feed
  on public.osha_regulation_updates (is_upcoming desc, published_date desc nulls last, created_at desc);

-- updated_at touch (function already defined by earlier migrations).
drop trigger if exists trg_osha_reg_updates_touch on public.osha_regulation_updates;
create trigger trg_osha_reg_updates_touch
  before update on public.osha_regulation_updates
  for each row execute function public.touch_updated_at();

-- RLS — read-everyone (authenticated), write-superadmin-only. The cron writes
-- with the service role, which bypasses RLS, so the write policy only governs
-- the rare human-via-browser path.
alter table public.osha_regulation_updates enable row level security;

drop policy if exists "osha_reg_updates_read_all" on public.osha_regulation_updates;
create policy "osha_reg_updates_read_all"
  on public.osha_regulation_updates
  for select to authenticated
  using (true);

drop policy if exists "osha_reg_updates_write_superadmin" on public.osha_regulation_updates;
create policy "osha_reg_updates_write_superadmin"
  on public.osha_regulation_updates
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
