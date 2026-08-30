-- Migration 233: Global SDS Reference Library — Phase 1 schema.
--
-- Today every tenant onboards into an EMPTY chemical catalog and
-- rediscovers each SDS on demand (chemical_products / chemical_sds_documents
-- are tenant-scoped — migration 089). This introduces a SHARED, cross-tenant
-- reference library of common manufacturing chemicals so lookup, onboarding,
-- and printing are near-instant.
--
-- Design decision (copyright / document-of-record): the library stores
-- chemical identity + denormalized GHS metadata + the OFFICIAL manufacturer
-- SOURCE URL and a verification hash — it does NOT centrally store or
-- redistribute manufacturer PDFs. When a tenant "adopts" an entry (Phase 3),
-- the app fetches a FRESH copy from source_url into THAT tenant's own storage.
-- So this library is a pointer/metadata index, never the authoritative SDS.
--
-- These tables are SYSTEM-WIDE (no tenant_id) and follow the prop65_chemicals
-- pattern (migration 170): RLS read-all to any authenticated user, writes
-- restricted to superadmins; touch_updated_at + log_audit triggers on the
-- content tables. The server-side seeder (Phase 2) writes via the service
-- role, which bypasses RLS.
--
-- Four tables:
--   sds_library_chemicals   global chemical identity + metadata + source URL
--   sds_library_sources     candidate SDS URLs per chemical (discover returns up to 5)
--   sds_library_seed_runs   AI seeding job tracking (Phase 2)
--   sds_library_seed_items  resumable per-chemical work queue for a seed run
--
-- Idempotent — guarded with `if not exists` / `do $$ ... $$` blocks.

begin;

-- pg_trgm for the canonical_name trigram index (already created in 089;
-- guarded so this migration is self-contained).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm;
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. sds_library_seed_runs — AI seeding job tracking (created first so
--    sds_library_chemicals.seed_run_id can reference it)
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.sds_library_seed_runs (
  id            uuid not null primary key default gen_random_uuid(),

  status        text not null default 'list_pending'
                  check (status in ('list_pending','list_review','researching','paused','completed','failed')),
  target_count  int check (target_count is null or target_count > 0),
  -- Snapshot of {proposed, approved, researched, found, not_found, error}
  -- refreshed each drip so the dashboard reads one row, not an aggregate.
  counts        jsonb not null default '{}'::jsonb,
  notes         text,

  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_sds_library_seed_runs_touch on public.sds_library_seed_runs;
create trigger trg_sds_library_seed_runs_touch
  before update on public.sds_library_seed_runs
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. sds_library_chemicals — the global catalog row
-- ──────────────────────────────────────────────────────────────────────────
--
-- Column types mirror chemical_products (089) so the Phase 3 adopt clone is
-- a 1:1 spread. The difference from chemical_products: no tenant_id, no
-- stored PDF — provenance is source_url + last_verified_fetch_hash only.

create table if not exists public.sds_library_chemicals (
  id            uuid not null primary key default gen_random_uuid(),

  -- Identity
  canonical_name text not null check (length(btrim(canonical_name)) > 0),
  manufacturer   text,
  product_code   text,
  cas_primary    text,                                    -- nullable: mixtures have none
  cas_numbers    text[] not null default '{}'::text[],
  synonyms       text[] not null default '{}'::text[],

  -- GHS / physical metadata (mirrors chemical_products)
  physical_state text check (physical_state in
    ('solid','liquid','gas','aerosol','mixture','other')),
  ghs_pictograms           text[] not null default '{}'::text[],
  ghs_signal_word          text check (ghs_signal_word in ('danger','warning')),
  hazard_statements        jsonb,
  precautionary_statements jsonb,
  nfpa_health        smallint check (nfpa_health between 0 and 4),
  nfpa_flammability  smallint check (nfpa_flammability between 0 and 4),
  nfpa_instability   smallint check (nfpa_instability between 0 and 4),
  nfpa_special       text,
  ppe_required       text[] not null default '{}'::text[],
  flash_point_c      numeric,
  boiling_point_c    numeric,
  vapor_pressure_kpa numeric,
  pel_twa_ppm        numeric,
  stel_ppm           numeric,
  idlh_ppm           numeric,
  first_aid          jsonb,
  firefighting       jsonb,
  spill_cleanup      jsonb,
  storage_class      text,
  incompatibilities  text[] not null default '{}'::text[],
  dot_un_number      text,
  dot_hazard_class   text,
  dot_packing_group  text,

  -- Source / provenance (the key difference from chemical_products):
  -- the official manufacturer URL + last verification hash, never a PDF.
  source_url               text,
  source_host              text,                          -- denormalized for allowlist-coverage analytics
  last_verified_fetch_hash text,                          -- sha256 hex of the last successful verify fetch
  last_verified_at         timestamptz,
  last_verify_outcome      text,                          -- mirrors FetchOutcome from chemicalSdsFetch
  sds_revision_date        date,

  -- Parse provenance (full payload kept for audit, like chemical_sds_documents)
  parsed_payload   jsonb,
  parse_model      text,
  parse_confidence numeric,

  -- Lifecycle / review
  review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected','needs_research')),
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  seed_run_id   uuid references public.sds_library_seed_runs(id) on delete set null,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Dedupe: one library row per (name, manufacturer, primary CAS). Expression
-- index (not a UNIQUE constraint) so the coalesce() of the nullable columns
-- collapses NULLs to '' and a missing manufacturer/CAS still dedupes. We do
-- NOT hard-unique on CAS alone — multiple manufacturers per CAS is legitimate.
create unique index if not exists uq_sds_library_identity
  on public.sds_library_chemicals
  (lower(canonical_name), coalesce(manufacturer, ''), coalesce(cas_primary, ''));

create index if not exists idx_sds_library_name_trgm
  on public.sds_library_chemicals using gin (canonical_name gin_trgm_ops);
create index if not exists idx_sds_library_cas
  on public.sds_library_chemicals using gin (cas_numbers);
create index if not exists idx_sds_library_pictograms
  on public.sds_library_chemicals using gin (ghs_pictograms);
create index if not exists idx_sds_library_review
  on public.sds_library_chemicals (review_status);
create index if not exists idx_sds_library_source_host
  on public.sds_library_chemicals (source_host);
create index if not exists idx_sds_library_seed_run
  on public.sds_library_chemicals (seed_run_id);

drop trigger if exists trg_sds_library_chemicals_touch on public.sds_library_chemicals;
create trigger trg_sds_library_chemicals_touch
  before update on public.sds_library_chemicals
  for each row execute function public.touch_updated_at();

-- Audit the library content (who approved / edited an entry). Seed-run/item
-- bookkeeping below is high-churn transient state and is intentionally NOT
-- audited to keep audit_log signal-rich.
drop trigger if exists trg_audit_sds_library_chemicals on public.sds_library_chemicals;
create trigger trg_audit_sds_library_chemicals
  after insert or update or delete on public.sds_library_chemicals
  for each row execute function public.log_audit('id');

-- ──────────────────────────────────────────────────────────────────────────
-- 3. sds_library_sources — candidate SDS URLs per chemical
-- ──────────────────────────────────────────────────────────────────────────
--
-- discoverSds returns up to 5 candidates; we keep them all so a reviewer can
-- pick a better primary later and the verify cron (Phase 5) can fall back.

create table if not exists public.sds_library_sources (
  id            uuid not null primary key default gen_random_uuid(),
  chemical_id   uuid not null references public.sds_library_chemicals(id) on delete cascade,

  url           text not null check (length(btrim(url)) > 0),
  host          text,
  title         text,
  confidence    text check (confidence in ('high','medium','low')),
  reasons       text,
  -- The one promoted to sds_library_chemicals.source_url.
  is_primary    boolean not null default false,
  revision_date date,

  discovered_at      timestamptz not null default now(),
  last_fetch_outcome text,
  last_fetch_hash    text,
  last_checked_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (chemical_id, url)
);

create index if not exists idx_sds_library_sources_primary
  on public.sds_library_sources (chemical_id, is_primary);

drop trigger if exists trg_sds_library_sources_touch on public.sds_library_sources;
create trigger trg_sds_library_sources_touch
  before update on public.sds_library_sources
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_audit_sds_library_sources on public.sds_library_sources;
create trigger trg_audit_sds_library_sources
  after insert or update or delete on public.sds_library_sources
  for each row execute function public.log_audit('id');

-- ──────────────────────────────────────────────────────────────────────────
-- 4. sds_library_seed_items — resumable per-chemical work queue
-- ──────────────────────────────────────────────────────────────────────────
--
-- One row per proposed chemical in a seed run. status carries the queue
-- state so a crashed/timed-out drip just re-leases 'researching' rows; the
-- research route caps attempts before flagging 'error'.

create table if not exists public.sds_library_seed_items (
  id            uuid not null primary key default gen_random_uuid(),
  seed_run_id   uuid not null references public.sds_library_seed_runs(id) on delete cascade,

  proposed_name         text not null check (length(btrim(proposed_name)) > 0),
  proposed_cas          text,
  proposed_manufacturer text,
  rationale             text,                             -- why Claude proposed it — for human list review

  status        text not null default 'proposed'
                  check (status in ('proposed','approved','rejected','researching','found','not_found','error')),
  attempts      int not null default 0,
  last_attempt_at timestamptz,
  last_error    text,
  -- Set once researched into the library.
  chemical_id   uuid references public.sds_library_chemicals(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_sds_library_seed_items_identity
  on public.sds_library_seed_items
  (seed_run_id, lower(proposed_name), coalesce(proposed_cas, ''));
create index if not exists idx_sds_library_seed_items_queue
  on public.sds_library_seed_items (seed_run_id, status);

drop trigger if exists trg_sds_library_seed_items_touch on public.sds_library_seed_items;
create trigger trg_sds_library_seed_items_touch
  before update on public.sds_library_seed_items
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Row-Level Security — read-all to authenticated, write superadmin-only
--    (mirrors prop65_chemicals, migration 170)
-- ──────────────────────────────────────────────────────────────────────────

alter table public.sds_library_chemicals  enable row level security;
alter table public.sds_library_sources    enable row level security;
alter table public.sds_library_seed_runs  enable row level security;
alter table public.sds_library_seed_items enable row level security;

-- sds_library_chemicals
drop policy if exists "sds_library_chemicals_read_all" on public.sds_library_chemicals;
create policy "sds_library_chemicals_read_all"
  on public.sds_library_chemicals
  for select to authenticated
  using (true);

drop policy if exists "sds_library_chemicals_write_superadmin" on public.sds_library_chemicals;
create policy "sds_library_chemicals_write_superadmin"
  on public.sds_library_chemicals
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- sds_library_sources
drop policy if exists "sds_library_sources_read_all" on public.sds_library_sources;
create policy "sds_library_sources_read_all"
  on public.sds_library_sources
  for select to authenticated
  using (true);

drop policy if exists "sds_library_sources_write_superadmin" on public.sds_library_sources;
create policy "sds_library_sources_write_superadmin"
  on public.sds_library_sources
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- sds_library_seed_runs
drop policy if exists "sds_library_seed_runs_read_all" on public.sds_library_seed_runs;
create policy "sds_library_seed_runs_read_all"
  on public.sds_library_seed_runs
  for select to authenticated
  using (true);

drop policy if exists "sds_library_seed_runs_write_superadmin" on public.sds_library_seed_runs;
create policy "sds_library_seed_runs_write_superadmin"
  on public.sds_library_seed_runs
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

-- sds_library_seed_items
drop policy if exists "sds_library_seed_items_read_all" on public.sds_library_seed_items;
create policy "sds_library_seed_items_read_all"
  on public.sds_library_seed_items
  for select to authenticated
  using (true);

drop policy if exists "sds_library_seed_items_write_superadmin" on public.sds_library_seed_items;
create policy "sds_library_seed_items_write_superadmin"
  on public.sds_library_seed_items
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
