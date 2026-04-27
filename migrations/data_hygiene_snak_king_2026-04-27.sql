-- ============================================================
--  SNAK KING — LOTO DATABASE HYGIENE SCRIPT (Robust Rewrite)
--  Target: Supabase SQL Editor (PostgreSQL 15)
--  Tables: loto_equipment | loto_energy_steps | loto_hygiene_log (created here)
--  Date: 2026-04-27
--
--  This is a one-off operational script, NOT a versioned migration.
--  It cleans up real-world data anomalies surfaced by a full audit of
--  the 886 active equipment rows.
--
--  Safety rules (unchanged from the previous version):
--    1. We NEVER hard-DELETE from loto_equipment. Soft-delete via
--       decommissioned = true. Preserves history; keeps the app stable.
--    2. Every mutating section is wrapped in BEGIN/COMMIT. If pre-
--       flight assertions fail or the body errors, the transaction
--       rolls back and you can re-run the section after fixing.
--    3. Every change is journaled into loto_hygiene_log with section,
--       equipment_id, action, reason — queryable audit trail.
--    4. Each section is independent — run them one at a time. Stop at
--       the first error and inspect rather than barreling through.
--
--  The source-of-truth audit_log (from migration 003) ALSO captures
--  every row change via per-table triggers. loto_hygiene_log is the
--  higher-level "what hygiene op did we do" record on top of that.
-- ============================================================


-- ============================================================
-- SECTION -1 — SETUP: hygiene-log table + ISO-8601 timestamp helper
--                     (idempotent — safe to re-run)
-- ============================================================

create table if not exists public.loto_hygiene_log (
  id            uuid primary key default gen_random_uuid(),
  ran_at        timestamptz not null default now(),
  section       text not null,         -- e.g. 'section_1', 'section_4_cheese_curl'
  equipment_id  text,                  -- nullable for baseline / summary rows
  action        text not null,         -- decommission | rename | note_append | fk_repair | orphan_detected | snapshot | error
  reason        text not null,
  detail        jsonb                  -- optional structured before/after / counts
);

create index if not exists idx_loto_hygiene_log_section
  on public.loto_hygiene_log(section, ran_at desc);

comment on table public.loto_hygiene_log is
  'Higher-level audit trail for one-off LOTO data-hygiene runs. Complements the per-row audit_log triggers from migration 003.';

-- RLS — authenticated users can READ (the /admin/hygiene-log page
-- gates by is_admin at the route level, but we don''t want non-admins
-- to be able to bypass the UI and read the raw table either; still,
-- read access is the lighter case). All writes are admin-only — non-
-- admins must not be able to insert spoof rows that pollute the
-- compliance trail. Matches the pattern used by loto_org_config.
alter table public.loto_hygiene_log enable row level security;

drop policy if exists "loto_hygiene_log_admin_read" on public.loto_hygiene_log;
create policy "loto_hygiene_log_admin_read" on public.loto_hygiene_log
  for select
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "loto_hygiene_log_admin_write" on public.loto_hygiene_log;
create policy "loto_hygiene_log_admin_write" on public.loto_hygiene_log
  for all
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.is_admin = true)
  );

-- The original script used NOW()::text which produces Postgres default
-- text ('2026-04-27 14:30:00.123+00') — NOT ISO 8601 and inconsistent
-- with the app's new Date().toISOString() writes. This helper produces
-- exactly the ISO 8601 format the app uses, so column data stays
-- uniformly parseable as you run hygiene scripts over time.
create or replace function public._hygiene_now_iso()
  returns text
  language sql
  stable
as $$ select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- One-time baseline snapshot — captures "active count before this run"
-- so the final summary report can show the delta. Idempotent: only
-- inserts a baseline if none exists for today.
do $$
declare
  exists_today boolean;
  active_count int;
begin
  select exists (
    select 1 from public.loto_hygiene_log
     where section = 'baseline'
       and ran_at >= current_date::timestamptz
  ) into exists_today;

  if not exists_today then
    select count(*) into active_count
      from public.loto_equipment
     where decommissioned = false;

    insert into public.loto_hygiene_log (section, action, reason, detail)
    values ('baseline', 'snapshot',
            'Active equipment count at start of hygiene run',
            jsonb_build_object('active_count', active_count));

    raise notice '✓ Baseline captured: % active equipment rows', active_count;
  else
    raise notice 'ℹ Baseline already captured today — skipping.';
  end if;
end $$;


-- ============================================================
-- SECTION 0 — DIAGNOSTIC: read-only state check
--             Run this first, BEFORE any mutating section, to confirm
--             the data matches the audit you did. No transaction needed.
-- ============================================================

-- Overall counts
select
    count(*)                                           as total_rows,
    count(*) filter (where decommissioned = false)     as active,
    count(*) filter (where decommissioned = true)      as already_decommissioned,
    count(*) filter (where description = '' or description is null) as blank_descriptions
from public.loto_equipment;

-- Preview every row this script will touch
select equipment_id, description, department, decommissioned, notes
from public.loto_equipment
where equipment_id in (
    -- Cat A: duplicates
    '302-MX-01', '302-MX-1',
    -- Cat B: phantoms
    'CDM-4-SHIPPING', 'CDM-6-SHIPPING',
    'JEGN-520', 'USGN-510', 'USGN-320', 'USGN-330',
    'CRUNCH LINES', 'JECL-001',
    -- Cat E: data errors
    'SKAP-913', 'BGNN-100', 'SKPK203',
    'SKAP-1202', 'SKAP-1402', 'SKAP-1602', 'SKAP-1605', 'SKAP-1608', 'SKAP-1626',
    -- Cat E rename destinations (must NOT pre-exist)
    'BGGN-100', 'SKPK-203'
)
order by equipment_id;


-- ============================================================
-- SECTION 1 — CATEGORY A: confirmed duplicate
--             Decommission 302-MX-01 (keep 302-MX-1 as canonical).
-- ============================================================

begin;

do $$
declare
  duplicate_active int;
  canonical_active int;
begin
  select count(*) into duplicate_active
    from public.loto_equipment
   where equipment_id = '302-MX-01' and decommissioned = false;
  select count(*) into canonical_active
    from public.loto_equipment
   where equipment_id = '302-MX-1' and decommissioned = false;

  if duplicate_active <> 1 then
    raise exception 'Section 1 pre-flight failed: expected 302-MX-01 to be active (1 row), found %.', duplicate_active;
  end if;
  if canonical_active <> 1 then
    raise exception 'Section 1 pre-flight failed: canonical 302-MX-1 must exist and be active (1 row), found %.', canonical_active;
  end if;
  raise notice '✓ Section 1 pre-flight passed (duplicate active=1, canonical active=1).';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         notes = coalesce(notes || ' | ', '') ||
                 'DECOMMISSIONED 2026-04-27: Confirmed duplicate of 302-MX-1. ' ||
                 'Same physical machine. Use 302-MX-1 as the canonical equipment ID.',
         updated_at = public._hygiene_now_iso()
   where equipment_id = '302-MX-01'
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_1', equipment_id, 'decommission',
       'Confirmed duplicate of 302-MX-1 — same Shaffer Masa Mixer.'
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_1' and ran_at >= current_date::timestamptz;
  raise notice '✓ Section 1 complete: % row(s) decommissioned and logged.', cnt;
end $$;

commit;


-- ============================================================
-- SECTION 2 — CATEGORY B: 8 phantom entries (no standalone LOTO)
-- ============================================================

begin;

do $$
declare
  active_phantoms int;
begin
  select count(*) into active_phantoms
    from public.loto_equipment
   where equipment_id in (
     'CDM-4-SHIPPING','CDM-6-SHIPPING',
     'JEGN-520','USGN-510','USGN-320','USGN-330',
     'CRUNCH LINES','JECL-001'
   )
     and decommissioned = false;
  if active_phantoms <> 8 then
    raise exception 'Section 2 pre-flight failed: expected 8 active phantom rows, found %.', active_phantoms;
  end if;
  raise notice '✓ Section 2 pre-flight passed: 8 phantom rows active.';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         updated_at = public._hygiene_now_iso(),
         notes = case equipment_id
             when 'CDM-4-SHIPPING' then
               'DECOMMISSIONED 2026-04-27: This entry represents a conveyor drive motor component, not a standalone machine. ' ||
               'No separate LOTO procedure needed. Identify parent conveyor and add as energy source on that conveyor''s LOTO.'
             when 'CDM-6-SHIPPING' then
               'DECOMMISSIONED 2026-04-27: Same as CDM-4-SHIPPING — drive motor component only. ' ||
               'Merge into parent conveyor LOTO as an electrical energy source entry.'
             when 'JEGN-520' then
               'DECOMMISSIONED 2026-04-27: Fryer Basic Parts — spare parts/ancillary listing, not a machine with its own energy source. ' ||
               'All Jensen fryer maintenance covered under JEGN-500 (Fryer-Roaster) combined LOTO.'
             when 'USGN-510' then
               'DECOMMISSIONED 2026-04-27: Fryer Basic Parts — same as JEGN-520. ' ||
               'All USDA fryer maintenance covered under USGN-500 (Fryer) combined LOTO.'
             when 'USGN-320' then
               'DECOMMISSIONED 2026-04-27: Oil Tank — passive storage vessel with no motor. ' ||
               'Included as a chemical/thermal energy source step inside the USDA Fryer combined LOTO (USGN-500 group).'
             when 'USGN-330' then
               'DECOMMISSIONED 2026-04-27: Lard Tank — passive storage vessel with no motor. ' ||
               'Included as a chemical/thermal energy source step inside the USDA Fryer combined LOTO (USGN-500 group).'
             when 'CRUNCH LINES' then
               'DECOMMISSIONED 2026-04-27: Generic department umbrella entry — not a specific machine. ' ||
               'Individual Crunch Line equipment should be entered as distinct equipment IDs with proper prefixes.'
             when 'JECL-001' then
               'DECOMMISSIONED 2026-04-27: Generic system-level entry for the Jensen Cube Line. ' ||
               'Not a specific piece of equipment. Individual components JECL-100 through JECL-730 each have their own entries.'
             else notes
           end
   where equipment_id in (
     'CDM-4-SHIPPING','CDM-6-SHIPPING',
     'JEGN-520','USGN-510','USGN-320','USGN-330',
     'CRUNCH LINES','JECL-001'
   )
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_2', equipment_id, 'decommission',
       'Phantom entry — no standalone LOTO procedure required.'
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_2' and ran_at >= current_date::timestamptz;
  if cnt <> 8 then
    raise exception 'Section 2 verification failed: expected 8 logged rows, found %.', cnt;
  end if;
  raise notice '✓ Section 2 complete: 8 phantom rows decommissioned and logged.';
end $$;

commit;


-- ============================================================
-- SECTION 3A — Fix SKAP-913 wrong line label
-- ============================================================

begin;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_equipment where equipment_id = 'SKAP-913';
  if cnt <> 1 then
    raise exception 'Section 3A pre-flight failed: expected 1 row for SKAP-913, found %.', cnt;
  end if;
  raise notice '✓ Section 3A pre-flight passed.';
end $$;

with changed as (
  update public.loto_equipment
     set description = 'SKAP-913 (PALLET TRANSFER CONVEYOR #9-13 - Automated Packaging)',
         notes = coalesce(notes || ' | ', '') ||
                 'CORRECTED 2026-04-27: Description had wrong line number (#7-14). ' ||
                 'This ID is in Line 9 sequence. Corrected to #9-13 — verify exact function in field.',
         updated_at = public._hygiene_now_iso()
   where equipment_id = 'SKAP-913'
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_3A', equipment_id, 'note_append',
       'Description corrected: line number #7-14 → #9-13.'
  from changed;

do $$ begin raise notice '✓ Section 3A complete: SKAP-913 description corrected.'; end $$;

commit;


-- ============================================================
-- SECTION 3B — Rename BGNN-100 → BGGN-100 (typo in prefix)
--              Cascades to loto_energy_steps. Wrapped in one
--              transaction so rename + child rename + log either
--              all succeed or all roll back.
-- ============================================================

begin;

-- Pre-flight: source must exist, destination must NOT exist.
do $$
declare
  src_count   int;
  dst_count   int;
  child_count int;
begin
  select count(*) into src_count from public.loto_equipment where equipment_id = 'BGNN-100';
  select count(*) into dst_count from public.loto_equipment where equipment_id = 'BGGN-100';
  select count(*) into child_count from public.loto_energy_steps where equipment_id = 'BGNN-100';

  if src_count <> 1 then
    raise exception 'Section 3B pre-flight failed: expected 1 row BGNN-100, found %.', src_count;
  end if;
  if dst_count <> 0 then
    raise exception 'Section 3B pre-flight failed: destination BGGN-100 already exists (% rows). Manual reconciliation needed.', dst_count;
  end if;
  raise notice '✓ Section 3B pre-flight passed (src=1, dst=0, % child energy_step(s) to migrate).', child_count;
end $$;

-- Migrate children FIRST so the parent rename never violates FK
-- (whether the FK has CASCADE or not — this works in either case).
with moved as (
  update public.loto_energy_steps
     set equipment_id = 'BGGN-100'
   where equipment_id = 'BGNN-100'
   returning id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason, detail)
select 'section_3B', 'BGGN-100', 'fk_repair',
       'Migrated loto_energy_steps.equipment_id BGNN-100 → BGGN-100',
       jsonb_build_object('step_id', id)
  from moved;

-- Rename parent.
with changed as (
  update public.loto_equipment
     set equipment_id = 'BGGN-100',
         prefix = 'BGGN',
         notes = coalesce(notes || ' | ', '') ||
                 'CORRECTED 2026-04-27: equipment_id renamed from BGNN-100 to BGGN-100. ' ||
                 'Original had typo in prefix (BGNN vs BGGN). All other Building Grounds items use BGGN.',
         updated_at = public._hygiene_now_iso()
   where equipment_id = 'BGNN-100'
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_3B', equipment_id, 'rename',
       'Equipment ID renamed BGNN-100 → BGGN-100 (prefix typo fix).'
  from changed;

-- Post-flight: confirm no orphans remain.
do $$
declare
  orphans int;
begin
  select count(*) into orphans from public.loto_energy_steps where equipment_id = 'BGNN-100';
  if orphans > 0 then
    insert into public.loto_hygiene_log (section, equipment_id, action, reason, detail)
    values ('section_3B', 'BGNN-100', 'orphan_detected',
            format('%s loto_energy_steps still reference old equipment_id BGNN-100 after rename', orphans),
            jsonb_build_object('orphan_count', orphans));
    raise exception 'Section 3B post-flight failed: % orphaned energy_steps still reference BGNN-100.', orphans;
  end if;
  raise notice '✓ Section 3B post-flight passed: no orphans.';
end $$;

commit;


-- ============================================================
-- SECTION 3C — Rename SKPK203 → SKPK-203 (missing hyphen)
-- ============================================================

begin;

do $$
declare
  src_count   int;
  dst_count   int;
  child_count int;
begin
  select count(*) into src_count from public.loto_equipment where equipment_id = 'SKPK203';
  select count(*) into dst_count from public.loto_equipment where equipment_id = 'SKPK-203';
  select count(*) into child_count from public.loto_energy_steps where equipment_id = 'SKPK203';

  if src_count <> 1 then
    raise exception 'Section 3C pre-flight failed: expected 1 row SKPK203, found %.', src_count;
  end if;
  if dst_count <> 0 then
    raise exception 'Section 3C pre-flight failed: destination SKPK-203 already exists (% rows). Manual reconciliation needed.', dst_count;
  end if;
  raise notice '✓ Section 3C pre-flight passed (src=1, dst=0, % child energy_step(s) to migrate).', child_count;
end $$;

with moved as (
  update public.loto_energy_steps
     set equipment_id = 'SKPK-203'
   where equipment_id = 'SKPK203'
   returning id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason, detail)
select 'section_3C', 'SKPK-203', 'fk_repair',
       'Migrated loto_energy_steps.equipment_id SKPK203 → SKPK-203',
       jsonb_build_object('step_id', id)
  from moved;

with changed as (
  update public.loto_equipment
     set equipment_id = 'SKPK-203',
         notes = coalesce(notes || ' | ', '') ||
                 'CORRECTED 2026-04-27: Renamed from SKPK203 to SKPK-203. ' ||
                 'Missing hyphen in original ID breaks sort order and naming convention.',
         updated_at = public._hygiene_now_iso()
   where equipment_id = 'SKPK203'
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_3C', equipment_id, 'rename',
       'Equipment ID renamed SKPK203 → SKPK-203 (added missing hyphen).'
  from changed;

do $$
declare
  orphans int;
begin
  select count(*) into orphans from public.loto_energy_steps where equipment_id = 'SKPK203';
  if orphans > 0 then
    insert into public.loto_hygiene_log (section, equipment_id, action, reason, detail)
    values ('section_3C', 'SKPK203', 'orphan_detected',
            format('%s loto_energy_steps still reference old equipment_id SKPK203 after rename', orphans),
            jsonb_build_object('orphan_count', orphans));
    raise exception 'Section 3C post-flight failed: % orphaned energy_steps still reference SKPK203.', orphans;
  end if;
  raise notice '✓ Section 3C post-flight passed: no orphans.';
end $$;

commit;


-- ============================================================
-- SECTION 3E — Flag blank-description entries for field review
-- ============================================================

begin;

do $$
declare
  flagged int;
begin
  select count(*) into flagged
    from public.loto_equipment
   where equipment_id in ('SKAP-1202','SKAP-1402','SKAP-1602','SKAP-1605','SKAP-1608','SKAP-1626')
     and (description is null or description = '' or description = ' ');
  raise notice '✓ Section 3E pre-flight: % of 6 candidate row(s) have blank descriptions.', flagged;
end $$;

with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'ACTION REQUIRED 2026-04-27: Description is blank. ' ||
                 'Field verification needed — identify this equipment on the floor and update description in SOTERIA. ' ||
                 'Do not write LOTO procedure until equipment identity is confirmed.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKAP-1202','SKAP-1402','SKAP-1602','SKAP-1605','SKAP-1608','SKAP-1626')
     and (description is null or description = '' or description = ' ')
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_3E', equipment_id, 'note_append',
       'Flagged for field verification — blank description.'
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_3E' and ran_at >= current_date::timestamptz;
  raise notice '✓ Section 3E complete: % row(s) flagged for field review.', cnt;
end $$;

commit;


-- ============================================================
-- SECTION 4 — CATEGORY C: combined-LOTO group notes
--             Each group runs in its own transaction with its own
--             pre-flight on the expected count of active rows.
--             Reason: business intent is per-group, and rolling back
--             a single group on pre-flight failure shouldn't lose
--             the others.
-- ============================================================

-- Reusable per-group helper. Inlined as a DO block per group rather
-- than a function so the asserts can RAISE EXCEPTION cleanly inside
-- each transaction without tying everything to a global routine.

-- ── 4.1 Cheese Curl Fryer System (5 items) ──────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKCC-580','SKCC-590','SKCC-600','SKCC-610','SKCC-620')
     and decommissioned = false;
  if cnt <> 5 then raise exception 'Section 4.1 pre-flight failed: expected 5 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.1 (Cheese Curl Fryer) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Part of the Cheese Curl Fryer Oil Loop system. ' ||
                 'Write ONE combined LOTO procedure covering: SKCC-580 (Main Oil Pump), ' ||
                 'SKCC-590 (Drum Pre Filter), SKCC-600 (Oil Transfer Pump), ' ||
                 'SKCC-610 (Fryer), SKCC-620 (Heat Exchanger). ' ||
                 'All share one closed hot oil circuit — cannot be individually isolated.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKCC-580','SKCC-590','SKCC-600','SKCC-610','SKCC-620')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_cheese_curl', equipment_id, 'note_append',
       'Combined LOTO group — Cheese Curl Fryer Oil Loop system.'
  from changed;
do $$ begin raise notice '✓ Section 4.1 (Cheese Curl Fryer) complete.'; end $$;
commit;

-- ── 4.2 TC1 Fryer System (4 items) ──────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKT1-540','SKT1-550','SKT1-560','SKT1-570')
     and decommissioned = false;
  if cnt <> 4 then raise exception 'Section 4.2 pre-flight failed: expected 4 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.2 (TC1 Fryer) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Part of the TC1 Fryer Oil Loop system. ' ||
                 'ONE combined LOTO procedure covers: SKT1-540, SKT1-550, SKT1-560, SKT1-570.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKT1-540','SKT1-550','SKT1-560','SKT1-570')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_tc1', equipment_id, 'note_append',
       'Combined LOTO group — TC1 Fryer Oil Loop.'
  from changed;
do $$ begin raise notice '✓ Section 4.2 (TC1 Fryer) complete.'; end $$;
commit;

-- ── 4.3 TC2 Fryer System (4 items) ──────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKT2-580','SKT2-590','SKT2-600','SKT2-610')
     and decommissioned = false;
  if cnt <> 4 then raise exception 'Section 4.3 pre-flight failed: expected 4 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.3 (TC2 Fryer) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Part of the TC2 Fryer Oil Loop system. ' ||
                 'ONE combined LOTO procedure covers: SKT2-580, SKT2-590, SKT2-600, SKT2-610.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKT2-580','SKT2-590','SKT2-600','SKT2-610')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_tc2', equipment_id, 'note_append',
       'Combined LOTO group — TC2 Fryer Oil Loop.'
  from changed;
do $$ begin raise notice '✓ Section 4.3 (TC2 Fryer) complete.'; end $$;
commit;

-- ── 4.4 Jensen Fryer System (2 items) ───────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JEGN-500','JEGN-510')
     and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.4 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.4 (Jensen Fryer) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Part of the Jensen Fryer system. ' ||
                 'ONE combined LOTO procedure covers: JEGN-500, JEGN-510.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JEGN-500','JEGN-510')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_jensen_fryer', equipment_id, 'note_append',
       'Combined LOTO group — Jensen Fryer.'
  from changed;
do $$ begin raise notice '✓ Section 4.4 (Jensen Fryer) complete.'; end $$;
commit;

-- ── 4.5 USDA Fryer System (4 items) ─────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('USGN-350','USGN-500','USGN-520','USGN-570')
     and decommissioned = false;
  if cnt <> 4 then raise exception 'Section 4.5 pre-flight failed: expected 4 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.5 (USDA Fryer) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Part of the USDA Fryer Oil Loop system. ' ||
                 'ONE combined LOTO procedure covers: USGN-350, USGN-500, USGN-520, USGN-570.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('USGN-350','USGN-500','USGN-520','USGN-570')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_usda_fryer', equipment_id, 'note_append',
       'Combined LOTO group — USDA Fryer Oil Loop.'
  from changed;
do $$ begin raise notice '✓ Section 4.5 (USDA Fryer) complete.'; end $$;
commit;

-- ── 4.6 Jensen Caramel Mix Kettle (2 items) ─────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JECA-530','JECA-540') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.6 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.6 (Jensen Caramel Mix) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Mix Kettle and pump share one hot liquid circuit. ' ||
                 'ONE combined LOTO covers: JECA-530, JECA-540.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JECA-530','JECA-540') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_caramel_mix', equipment_id, 'note_append',
       'Combined LOTO group — Jensen Caramel Mix Kettle + pump.'
  from changed;
do $$ begin raise notice '✓ Section 4.6 (Jensen Caramel Mix) complete.'; end $$;
commit;

-- ── 4.7 Jensen Caramel Use Kettle (3 items) ─────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JECA-550','JECA-560','JECA-570') and decommissioned = false;
  if cnt <> 3 then raise exception 'Section 4.7 pre-flight failed: expected 3 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.7 (Jensen Caramel Use) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Use Kettle, pump, and condensate pump share one system. ' ||
                 'ONE combined LOTO covers: JECA-550, JECA-560, JECA-570.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JECA-550','JECA-560','JECA-570') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_caramel_use', equipment_id, 'note_append',
       'Combined LOTO group — Jensen Caramel Use Kettle + pumps.'
  from changed;
do $$ begin raise notice '✓ Section 4.7 (Jensen Caramel Use) complete.'; end $$;
commit;

-- ── 4.8 Popcorn Mix Kettle (2 items) ────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKPC-840','SKPC-850') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.8 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.8 (Popcorn Mix) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: ONE combined LOTO covers: SKPC-840, SKPC-850.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKPC-840','SKPC-850') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_popcorn_mix', equipment_id, 'note_append',
       'Combined LOTO group — Popcorn Mix Kettle + pump.'
  from changed;
do $$ begin raise notice '✓ Section 4.8 (Popcorn Mix) complete.'; end $$;
commit;

-- ── 4.9 Popcorn Use Kettle (2 items) ────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKPC-860','SKPC-870') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.9 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.9 (Popcorn Use) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: ONE combined LOTO covers: SKPC-860, SKPC-870.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKPC-860','SKPC-870') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_popcorn_use', equipment_id, 'note_append',
       'Combined LOTO group — Popcorn Use Kettle + pump.'
  from changed;
do $$ begin raise notice '✓ Section 4.9 (Popcorn Use) complete.'; end $$;
commit;

-- ── 4.10 Cheese Puff Mixing Kettle (2 items) ────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKPF-850','SKPF-860') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.10 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.10 (Cheese Puff Mix) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: ONE combined LOTO covers: SKPF-850, SKPF-860.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKPF-850','SKPF-860') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_puff_mix', equipment_id, 'note_append',
       'Combined LOTO group — Cheese Puff Mix Kettle + pump.'
  from changed;
do $$ begin raise notice '✓ Section 4.10 (Cheese Puff Mix) complete.'; end $$;
commit;

-- ── 4.11 Cheese Puff Use Kettle (2 items) ───────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKPF-870','SKPF-880') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.11 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.11 (Cheese Puff Use) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: ONE combined LOTO covers: SKPF-870, SKPF-880.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKPF-870','SKPF-880') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_puff_use', equipment_id, 'note_append',
       'Combined LOTO group — Cheese Puff Use Kettle + pump.'
  from changed;
do $$ begin raise notice '✓ Section 4.11 (Cheese Puff Use) complete.'; end $$;
commit;

-- ── 4.12 Jensen Peanut Line Kettles (3 items) ───────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JEPL-101','JEPL-102','JEPL-103') and decommissioned = false;
  if cnt <> 3 then raise exception 'Section 4.12 pre-flight failed: expected 3 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.12 (Jensen Peanut Line) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: All three share one slurry circuit. ' ||
                 'ONE combined LOTO covers: JEPL-101, JEPL-102, JEPL-103.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JEPL-101','JEPL-102','JEPL-103') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_peanut', equipment_id, 'note_append',
       'Combined LOTO group — Jensen Peanut Line slurry kettles.'
  from changed;
do $$ begin raise notice '✓ Section 4.12 (Jensen Peanut Line) complete.'; end $$;
commit;

-- ── 4.13 Popcorn Tumbler + Blower (2 items) ─────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('SKPC-810','SKPC-820') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.13 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.13 (Popcorn Tumbler) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Tumbler and its blower motor are one machine. ' ||
                 'ONE combined LOTO covers: SKPC-810, SKPC-820.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('SKPC-810','SKPC-820') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_popcorn_tumbler', equipment_id, 'note_append',
       'Combined LOTO group — Popcorn Tumbler + Blower.'
  from changed;
do $$ begin raise notice '✓ Section 4.13 (Popcorn Tumbler) complete.'; end $$;
commit;

-- ── 4.14 Jensen Cube Slitter + Belt (2 items) ───────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JECL-590','JECL-600') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.14 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.14 (Cube Slitter) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Slitter and discharge belt share drive system. ' ||
                 'ONE combined LOTO covers: JECL-590, JECL-600.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JECL-590','JECL-600') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_cube_slitter', equipment_id, 'note_append',
       'Combined LOTO group — Jensen Cube Slitter + Belt.'
  from changed;
do $$ begin raise notice '✓ Section 4.14 (Cube Slitter) complete.'; end $$;
commit;

-- ── 4.15 Jensen Cube Guillotine + Belt (2 items) ────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JECL-610','JECL-620') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 4.15 pre-flight failed: expected 2 active rows, found %.', cnt; end if;
  raise notice '✓ Section 4.15 (Cube Guillotine) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'COMBINED LOTO GROUP 2026-04-27: Guillotine and discharge belt share drive system. ' ||
                 'ONE combined LOTO covers: JECL-610, JECL-620.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JECL-610','JECL-620') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_cube_guillotine', equipment_id, 'note_append',
       'Combined LOTO group — Jensen Cube Guillotine + Belt.'
  from changed;
do $$ begin raise notice '✓ Section 4.15 (Cube Guillotine) complete.'; end $$;
commit;


-- ============================================================
-- SECTION 5 — CATEGORY D: cross-reference notes
--             Each cross-ref group runs in its own transaction.
-- ============================================================

-- ── 5.1 Boilers — shared steam header ───────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('BGGN-011','BGGN-012','BGGN-013') and decommissioned = false;
  if cnt <> 3 then raise exception 'Section 5.1 pre-flight failed: expected 3 active boilers, found %.', cnt; end if;
  raise notice '✓ Section 5.1 (Boilers) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'CROSS-REF LOTO 2026-04-27: All 3 boilers (BGGN-011, BGGN-012, BGGN-013) share a common steam header. ' ||
                 'When working on steam distribution piping, all three must be locked at their individual steam isolation valves. ' ||
                 'Verify steam header pressure = 0 PSI before proceeding.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('BGGN-011','BGGN-012','BGGN-013') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_boilers', equipment_id, 'note_append',
       'Cross-ref note — shared steam header.'
  from changed;
do $$ begin raise notice '✓ Section 5.1 (Boilers) complete.'; end $$;
commit;

-- ── 5.2 Air Compressors — shared receiver ───────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('BGGN-030','BGGN-031') and decommissioned = false;
  if cnt <> 2 then raise exception 'Section 5.2 pre-flight failed: expected 2 active compressors, found %.', cnt; end if;
  raise notice '✓ Section 5.2 (Air Compressors) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'CROSS-REF LOTO 2026-04-27: BGGN-030 and BGGN-031 share a common air receiver and distribution header. ' ||
                 'When working on the receiver or main air header, BOTH compressors must be locked out. ' ||
                 'Close and lock inlet ball valve on receiver from each compressor. Verify receiver gauge = 0 PSI.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('BGGN-030','BGGN-031') and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_compressors', equipment_id, 'note_append',
       'Cross-ref note — shared air receiver.'
  from changed;
do $$ begin raise notice '✓ Section 5.2 (Air Compressors) complete.'; end $$;
commit;

-- ── 5.3 Vib Hoppers (5 items) ───────────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JEGN-880','JEGN-890','JEGN-900','JEGN-910','JEGN-920')
     and decommissioned = false;
  if cnt <> 5 then raise exception 'Section 5.3 pre-flight failed: expected 5 active hoppers, found %.', cnt; end if;
  raise notice '✓ Section 5.3 (Vib Hoppers) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'CROSS-REF LOTO 2026-04-27: This vibratory hopper feeds directly into its paired bucket elevator boot section. ' ||
                 'When performing maintenance on the bucket elevator, also lock out this hopper to prevent product from striking the worker.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JEGN-880','JEGN-890','JEGN-900','JEGN-910','JEGN-920')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_vib_hoppers', equipment_id, 'note_append',
       'Cross-ref note — paired with bucket elevator downstream.'
  from changed;
do $$ begin raise notice '✓ Section 5.3 (Vib Hoppers) complete.'; end $$;
commit;

-- ── 5.4 Bucket Elevators (5 items) ──────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JEGN-930','JEGN-940','JEGN-950','JEGN-960','JEGN-970')
     and decommissioned = false;
  if cnt <> 5 then raise exception 'Section 5.4 pre-flight failed: expected 5 active elevators, found %.', cnt; end if;
  raise notice '✓ Section 5.4 (Bucket Elevators) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'CROSS-REF LOTO 2026-04-27: This bucket elevator is fed by its paired vibratory hopper. ' ||
                 'When performing maintenance on this elevator, also lock out the corresponding vib hopper ' ||
                 '(JEGN-880/890/900/910/920 — match the last digit pair to identify your hopper).',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JEGN-930','JEGN-940','JEGN-950','JEGN-960','JEGN-970')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_bucket_elevators', equipment_id, 'note_append',
       'Cross-ref note — paired with upstream vib hopper.'
  from changed;
do $$ begin raise notice '✓ Section 5.4 (Bucket Elevators) complete.'; end $$;
commit;

-- ── 5.5 Metal Detectors inline with Baggers (22 items) ──────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in (
     'SNK-622','SNK-623','SNK-624','SNK-625','SNK-626','SNK-627','SNK-628',
     'SNK-629','SNK-630','SNK-631','SNK-631A','SNK-632','SNK-633','SNK-634',
     'SNK-635','SNK-636','SNK-637','SNK-638','SNK-639','SNK-640','SNK-641','SNK-642'
   ) and decommissioned = false;
  if cnt <> 22 then raise exception 'Section 5.5 pre-flight failed: expected 22 active detectors, found %.', cnt; end if;
  raise notice '✓ Section 5.5 (Metal Detectors) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'CROSS-REF LOTO 2026-04-27: This metal detector is directly inline with an Atlas/UVA bagger upstream. ' ||
                 'When working inside the detector aperture or on its conveyor belt, also lock out the upstream bagger ' ||
                 '(SNK-601 through SNK-621 — match position number: Detector 1 → Bagger 1, etc.).',
         updated_at = public._hygiene_now_iso()
   where equipment_id in (
     'SNK-622','SNK-623','SNK-624','SNK-625','SNK-626','SNK-627','SNK-628',
     'SNK-629','SNK-630','SNK-631','SNK-631A','SNK-632','SNK-633','SNK-634',
     'SNK-635','SNK-636','SNK-637','SNK-638','SNK-639','SNK-640','SNK-641','SNK-642'
   ) and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_metal_detectors', equipment_id, 'note_append',
       'Cross-ref note — paired with upstream bagger.'
  from changed;
do $$ begin raise notice '✓ Section 5.5 (Metal Detectors) complete.'; end $$;
commit;

-- ── 5.6 JECL Chillers (4 items) ─────────────────────────────────────────
begin;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.loto_equipment
   where equipment_id in ('JECL-680','JECL-690','JECL-700','JECL-710')
     and decommissioned = false;
  if cnt <> 4 then raise exception 'Section 5.6 pre-flight failed: expected 4 active chillers, found %.', cnt; end if;
  raise notice '✓ Section 5.6 (JECL Chillers) pre-flight passed.';
end $$;
with changed as (
  update public.loto_equipment
     set notes = coalesce(notes || ' | ', '') ||
                 'CROSS-REF LOTO 2026-04-27: This chiller serves the Jensen Cube Line cooling tunnels (JECL-580, JECL-670). ' ||
                 'When working on cooling tunnel chilled water connections, verify which chiller circuit(s) supply that tunnel ' ||
                 'and lock out those chiller(s) at the chilled water supply/return valves.',
         updated_at = public._hygiene_now_iso()
   where equipment_id in ('JECL-680','JECL-690','JECL-700','JECL-710')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_jecl_chillers', equipment_id, 'note_append',
       'Cross-ref note — chillers serve cooling tunnels.'
  from changed;
do $$ begin raise notice '✓ Section 5.6 (JECL Chillers) complete.'; end $$;
commit;


-- ============================================================
-- SECTION 6 — FINAL SUMMARY REPORT (read-only)
--             Run AFTER all sections to see the delta.
-- ============================================================

-- Headline stats
select
    (select (detail->>'active_count')::int
       from public.loto_hygiene_log
      where section = 'baseline'
        and ran_at >= current_date::timestamptz
      order by ran_at limit 1)                          as active_before,
    (select count(*) from public.loto_hygiene_log
      where action = 'decommission'
        and ran_at >= current_date::timestamptz)        as decommissioned_today,
    (select count(*) from public.loto_hygiene_log
      where action = 'note_append'
        and ran_at >= current_date::timestamptz)        as notes_appended_today,
    (select count(*) from public.loto_hygiene_log
      where action = 'rename'
        and ran_at >= current_date::timestamptz)        as renames_today,
    (select count(*) from public.loto_hygiene_log
      where action = 'fk_repair'
        and ran_at >= current_date::timestamptz)        as fk_repairs_today,
    (select count(*) from public.loto_hygiene_log
      where action = 'orphan_detected'
        and ran_at >= current_date::timestamptz)        as orphans_detected_today,
    (select count(*) from public.loto_equipment
      where decommissioned = false)                     as active_after;

-- Spot-check list: every equipment_id changed today and STILL active
-- (so the user can verify the notes / rename / etc. are right).
select
    eq.equipment_id,
    eq.description,
    eq.department,
    left(eq.notes, 200) as notes_preview,
    string_agg(distinct hl.section, ', ' order by hl.section) as sections_touched
from public.loto_equipment eq
join public.loto_hygiene_log hl on hl.equipment_id = eq.equipment_id
where hl.ran_at >= current_date::timestamptz
  and eq.decommissioned = false
group by eq.equipment_id, eq.description, eq.department, eq.notes
order by eq.equipment_id;

-- Anything flagged as a problem (orphans, errors, etc.)
select section, equipment_id, action, reason, detail, ran_at
  from public.loto_hygiene_log
 where action in ('orphan_detected','error')
   and ran_at >= current_date::timestamptz
 order by ran_at;
