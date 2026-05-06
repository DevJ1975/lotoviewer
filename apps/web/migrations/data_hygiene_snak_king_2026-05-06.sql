-- ============================================================
--  SNAK KING — LOTO DATABASE HYGIENE (FINAL — 2026-05-06)
--  Target: Supabase SQL Editor (PostgreSQL 15)
--  Project: zwtnpyjifbdytlektxlc (Soteria Main Project)
--  Tables: loto_equipment | loto_energy_steps | loto_hygiene_log
--
--  Reconstructed by Claude Code on 2026-05-06 from
--  HANDOFF_TO_CLAUDE_CODE_2026-05-06.md §6, mirroring the
--  conventions of data_hygiene_snak_king_2026-04-27.sql.
--
--  Scope: 26 decommissions across 5 groups, field-confirmed by
--  the 2026-05-01 walkdown (Cain, Raf, Karen):
--    SECTION 1 — Pita Line entire        (13 items)
--    SECTION 2 — Jensen                  ( 4 items)
--    SECTION 3 — Pop Caramel "don't use" ( 5 items)
--    SECTION 4 — USDA Packaging          ( 2 items)
--    SECTION 5 — Building & Grounds      ( 2 items)
--
--  Several IDs in this file SUPERSEDE classifications applied by
--  the 2026-04-27 hygiene run. Field walkdown is the source of
--  truth (per project §12 "Don't decom without field
--  confirmation"). Affected reversals are called out in the
--  per-item notes:
--    - SKPC-810 / SKPC-820  (was "Combined LOTO — Popcorn Tumbler + Blower")
--    - JEGN-500 / JEGN-510  (was "Combined LOTO — Jensen Fryer")
--    - JEGN-880 / JEGN-920  (was "Cross-ref — paired with bucket elevator")
--
--  Safety rules (unchanged from 2026-04-27):
--    1. NEVER hard-DELETE — soft-delete via decommissioned = true.
--    2. Every mutating section is BEGIN/COMMIT wrapped with a
--       pre-flight assertion on the expected active count.
--    3. Every change is journaled into loto_hygiene_log.
--    4. Sections are independent — run one at a time. Stop on
--       the first error and inspect.
--
--  Pre-run state (verified 2026-05-06): all 26 IDs present and
--  active in loto_equipment.
--  Expected delta: active 850 → 824, decommissioned 116 → 142.
-- ============================================================


-- ============================================================
-- SECTION -1 — Idempotent baseline snapshot for today's run.
--              loto_hygiene_log + RLS already exist from the
--              2026-04-27 setup. We just capture today's "active
--              count before this run" for the §6 summary delta.
-- ============================================================

do $$
declare
  exists_today boolean;
  active_count int;
begin
  select exists (
    select 1 from public.loto_hygiene_log
     where section = 'baseline_2026_05_06'
       and ran_at >= current_date::timestamptz
  ) into exists_today;

  if not exists_today then
    select count(*) into active_count
      from public.loto_equipment
     where decommissioned = false;

    insert into public.loto_hygiene_log (section, action, reason, detail)
    values ('baseline_2026_05_06', 'snapshot',
            'Active equipment count at start of 2026-05-06 hygiene run',
            jsonb_build_object('active_count', active_count));

    raise notice '✓ Baseline 2026-05-06 captured: % active equipment rows', active_count;
  else
    raise notice 'ℹ Baseline 2026-05-06 already captured today — skipping.';
  end if;
end $$;


-- ============================================================
-- SECTION 0 — DIAGNOSTIC: read-only state of the 26 candidate rows.
--             Run this BEFORE the mutating sections. Expect 26
--             rows back, all with decommissioned = false.
-- ============================================================

select
    eq.equipment_id,
    eq.description,
    eq.department,
    eq.decommissioned,
    (select count(*) from public.loto_energy_steps es
       where es.equipment_id = eq.equipment_id) as energy_step_count
from public.loto_equipment eq
where eq.equipment_id in (
  -- Pita Line (13)
  'SKPI-100','SKPI-120','SKPI-140','SKPI-160','SKPI-180',
  'SKPI-500-1','SKPI-500-2','SKPI-520','SKPI-540','SKPI-560',
  'SKPI-580','SKPI-600','SKPI-620',
  -- Jensen (4)
  'JEGN-500','JEGN-510','JEGN-880','JEGN-920',
  -- Pop Caramel (5)
  'SKPC-200','SKPC-500','SKPC-800','SKPC-810','SKPC-820',
  -- USDA Packaging (2)
  'USPK-502','USPK-503',
  -- Building & Grounds (2)
  'BGGN-006','BGGN-010'
)
order by eq.department, eq.equipment_id;


-- ============================================================
-- SECTION 1 — PITA LINE (13 items)
--   Field walkdown 2026-05-01: Pita Line was removed from the
--   facility. CoI floor plan confirms. No active equipment in
--   this department.
-- ============================================================

begin;

do $$
declare
  active_cnt int;
begin
  select count(*) into active_cnt
    from public.loto_equipment
   where equipment_id in (
     'SKPI-100','SKPI-120','SKPI-140','SKPI-160','SKPI-180',
     'SKPI-500-1','SKPI-500-2','SKPI-520','SKPI-540','SKPI-560',
     'SKPI-580','SKPI-600','SKPI-620'
   ) and decommissioned = false;
  if active_cnt <> 13 then
    raise exception 'Section 1 pre-flight failed: expected 13 active Pita Line rows, found %.', active_cnt;
  end if;
  raise notice '✓ Section 1 pre-flight passed: 13 Pita Line rows active.';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         updated_at = now(),
         notes = coalesce(notes || ' | ', '') ||
                 'DECOMMISSIONED 2026-05-06: Pita Line removed from facility. ' ||
                 'Field-confirmed by 2026-05-01 walkdown (Cain/Raf/Karen). ' ||
                 'CoI floor plan confirms removal. No replacement equipment in this department.'
   where equipment_id in (
     'SKPI-100','SKPI-120','SKPI-140','SKPI-160','SKPI-180',
     'SKPI-500-1','SKPI-500-2','SKPI-520','SKPI-540','SKPI-560',
     'SKPI-580','SKPI-600','SKPI-620'
   ) and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_1_pita_line', equipment_id, 'decommission',
       'Pita Line removed from facility (field walkdown 2026-05-01).'
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_1_pita_line' and ran_at >= current_date::timestamptz;
  if cnt <> 13 then
    raise exception 'Section 1 verification failed: expected 13 logged rows, found %.', cnt;
  end if;
  raise notice '✓ Section 1 complete: 13 Pita Line rows decommissioned and logged.';
end $$;

commit;


-- ============================================================
-- SECTION 2 — JENSEN (4 items)
--   JEGN-500 / JEGN-510: Jensen Fryer system removed (field 2026-05-01).
--     SUPERSEDES the 2026-04-27 "section_4_jensen_fryer" combined-LOTO
--     designation — that desk-audit categorization was wrong; field
--     walkdown found the equipment is not present.
--   JEGN-880 / JEGN-920: phantom IDs — only 3 vib hoppers actually
--     exist on the floor (JEGN-890/900/910). SUPERSEDES the 2026-04-27
--     "section_5_vib_hoppers" cross-ref note that listed all 5.
-- ============================================================

begin;

do $$
declare
  active_cnt int;
begin
  select count(*) into active_cnt
    from public.loto_equipment
   where equipment_id in ('JEGN-500','JEGN-510','JEGN-880','JEGN-920')
     and decommissioned = false;
  if active_cnt <> 4 then
    raise exception 'Section 2 pre-flight failed: expected 4 active Jensen rows, found %.', active_cnt;
  end if;
  raise notice '✓ Section 2 pre-flight passed: 4 Jensen rows active.';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         updated_at = now(),
         notes = coalesce(notes || ' | ', '') ||
                 case equipment_id
                   when 'JEGN-500' then
                     'DECOMMISSIONED 2026-05-06: Jensen Fryer-Roaster system not present on floor. ' ||
                     'Field-confirmed 2026-05-01 walkdown. SUPERSEDES the 2026-04-27 ' ||
                     '"section_4_jensen_fryer" combined-LOTO designation.'
                   when 'JEGN-510' then
                     'DECOMMISSIONED 2026-05-06: Jensen Fryer Filtration not present on floor. ' ||
                     'Field-confirmed 2026-05-01 walkdown. SUPERSEDES the 2026-04-27 ' ||
                     '"section_4_jensen_fryer" combined-LOTO designation.'
                   when 'JEGN-880' then
                     'DECOMMISSIONED 2026-05-06: Phantom ID — only JEGN-890/900/910 are actual ' ||
                     'vib hoppers on the floor. Field-confirmed 2026-05-01 walkdown. ' ||
                     'SUPERSEDES the 2026-04-27 "section_5_vib_hoppers" cross-ref note that ' ||
                     'incorrectly listed JEGN-880 as one of 5 active hoppers.'
                   when 'JEGN-920' then
                     'DECOMMISSIONED 2026-05-06: Phantom ID — only JEGN-890/900/910 are actual ' ||
                     'vib hoppers on the floor. Field-confirmed 2026-05-01 walkdown. ' ||
                     'SUPERSEDES the 2026-04-27 "section_5_vib_hoppers" cross-ref note that ' ||
                     'incorrectly listed JEGN-920 as one of 5 active hoppers.'
                   else notes
                 end
   where equipment_id in ('JEGN-500','JEGN-510','JEGN-880','JEGN-920')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason, detail)
select 'section_2_jensen', equipment_id, 'decommission',
       case
         when equipment_id in ('JEGN-500','JEGN-510')
           then 'Jensen Fryer system not on floor — supersedes 04-27 combined-LOTO designation.'
         else 'Phantom vib hopper ID — only 890/900/910 exist; supersedes 04-27 cross-ref.'
       end,
       jsonb_build_object('supersedes_2026_04_27',
         case when equipment_id in ('JEGN-500','JEGN-510') then 'section_4_jensen_fryer'
              else 'section_5_vib_hoppers' end)
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_2_jensen' and ran_at >= current_date::timestamptz;
  if cnt <> 4 then
    raise exception 'Section 2 verification failed: expected 4 logged rows, found %.', cnt;
  end if;
  raise notice '✓ Section 2 complete: 4 Jensen rows decommissioned and logged.';
end $$;

commit;


-- ============================================================
-- SECTION 3 — POP CARAMEL "we don't use" (5 items)
--   Field walkdown 2026-05-01: this equipment is not used.
--   SKPC-810 / SKPC-820 SUPERSEDE the 2026-04-27
--   "section_4_popcorn_tumbler" combined-LOTO designation —
--   the desk audit assumed they were active; field walkdown
--   confirmed they are not in use.
-- ============================================================

begin;

do $$
declare
  active_cnt int;
begin
  select count(*) into active_cnt
    from public.loto_equipment
   where equipment_id in ('SKPC-200','SKPC-500','SKPC-800','SKPC-810','SKPC-820')
     and decommissioned = false;
  if active_cnt <> 5 then
    raise exception 'Section 3 pre-flight failed: expected 5 active Pop Caramel rows, found %.', active_cnt;
  end if;
  raise notice '✓ Section 3 pre-flight passed: 5 Pop Caramel rows active.';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         updated_at = now(),
         notes = coalesce(notes || ' | ', '') ||
                 case
                   when equipment_id in ('SKPC-810','SKPC-820') then
                     'DECOMMISSIONED 2026-05-06: Equipment not in use per maintenance team. ' ||
                     'Field-confirmed 2026-05-01 walkdown. SUPERSEDES the 2026-04-27 ' ||
                     '"section_4_popcorn_tumbler" combined-LOTO designation.'
                   else
                     'DECOMMISSIONED 2026-05-06: Equipment not in use per maintenance team. ' ||
                     'Field-confirmed 2026-05-01 walkdown (Cain/Raf/Karen).'
                 end
   where equipment_id in ('SKPC-200','SKPC-500','SKPC-800','SKPC-810','SKPC-820')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason, detail)
select 'section_3_pop_caramel', equipment_id, 'decommission',
       case
         when equipment_id in ('SKPC-810','SKPC-820')
           then 'Not in use — supersedes 04-27 popcorn-tumbler combined-LOTO designation.'
         else 'Not in use per maintenance team (field walkdown 2026-05-01).'
       end,
       case
         when equipment_id in ('SKPC-810','SKPC-820')
           then jsonb_build_object('supersedes_2026_04_27','section_4_popcorn_tumbler')
         else null
       end
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_3_pop_caramel' and ran_at >= current_date::timestamptz;
  if cnt <> 5 then
    raise exception 'Section 3 verification failed: expected 5 logged rows, found %.', cnt;
  end if;
  raise notice '✓ Section 3 complete: 5 Pop Caramel rows decommissioned and logged.';
end $$;

commit;


-- ============================================================
-- SECTION 4 — USDA PACKAGING (2 items)
--   Atlas Baggers #2 (USPK-502) and #3 (USPK-503) — confirmed
--   gone from USDA Packaging area. Field walkdown 2026-05-01.
--   Note: both rows currently have 0 energy steps in DB.
-- ============================================================

begin;

do $$
declare
  active_cnt int;
begin
  select count(*) into active_cnt
    from public.loto_equipment
   where equipment_id in ('USPK-502','USPK-503')
     and decommissioned = false;
  if active_cnt <> 2 then
    raise exception 'Section 4 pre-flight failed: expected 2 active USDA Packaging rows, found %.', active_cnt;
  end if;
  raise notice '✓ Section 4 pre-flight passed: 2 USDA Packaging rows active.';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         updated_at = now(),
         notes = coalesce(notes || ' | ', '') ||
                 'DECOMMISSIONED 2026-05-06: Atlas Bagger removed from USDA Packaging. ' ||
                 'Field-confirmed 2026-05-01 walkdown.'
   where equipment_id in ('USPK-502','USPK-503')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_4_usda_pkg', equipment_id, 'decommission',
       'Atlas Bagger removed from USDA Packaging (field walkdown 2026-05-01).'
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_4_usda_pkg' and ran_at >= current_date::timestamptz;
  if cnt <> 2 then
    raise exception 'Section 4 verification failed: expected 2 logged rows, found %.', cnt;
  end if;
  raise notice '✓ Section 4 complete: 2 USDA Packaging rows decommissioned and logged.';
end $$;

commit;


-- ============================================================
-- SECTION 5 — BUILDING & GROUNDS (2 items)
--   BGGN-006 (Exhaust Fan 2) and BGGN-010 (Hot Water Heater) —
--   removed / replaced. Field walkdown 2026-05-01.
-- ============================================================

begin;

do $$
declare
  active_cnt int;
begin
  select count(*) into active_cnt
    from public.loto_equipment
   where equipment_id in ('BGGN-006','BGGN-010')
     and decommissioned = false;
  if active_cnt <> 2 then
    raise exception 'Section 5 pre-flight failed: expected 2 active Building & Grounds rows, found %.', active_cnt;
  end if;
  raise notice '✓ Section 5 pre-flight passed: 2 Building & Grounds rows active.';
end $$;

with changed as (
  update public.loto_equipment
     set decommissioned = true,
         updated_at = now(),
         notes = coalesce(notes || ' | ', '') ||
                 'DECOMMISSIONED 2026-05-06: Equipment removed/replaced. ' ||
                 'Field-confirmed 2026-05-01 walkdown.'
   where equipment_id in ('BGGN-006','BGGN-010')
     and decommissioned = false
   returning equipment_id
)
insert into public.loto_hygiene_log (section, equipment_id, action, reason)
select 'section_5_bldg_grounds', equipment_id, 'decommission',
       'Equipment removed/replaced (field walkdown 2026-05-01).'
  from changed;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from public.loto_hygiene_log
   where section = 'section_5_bldg_grounds' and ran_at >= current_date::timestamptz;
  if cnt <> 2 then
    raise exception 'Section 5 verification failed: expected 2 logged rows, found %.', cnt;
  end if;
  raise notice '✓ Section 5 complete: 2 Building & Grounds rows decommissioned and logged.';
end $$;

commit;


-- ============================================================
-- SECTION 6 — FINAL SUMMARY REPORT (read-only)
--   Run AFTER all five mutating sections complete.
-- ============================================================

-- Headline delta
select
    (select (detail->>'active_count')::int
       from public.loto_hygiene_log
      where section = 'baseline_2026_05_06'
        and ran_at >= current_date::timestamptz
      order by ran_at limit 1)                     as active_before,
    (select count(*) from public.loto_hygiene_log
      where action = 'decommission'
        and section like 'section_%'
        and ran_at >= current_date::timestamptz)   as decommissioned_today,
    (select count(*) from public.loto_equipment
      where decommissioned = false)                as active_after;

-- Per-section breakdown for today's run
select section, action, count(*) as n
  from public.loto_hygiene_log
 where ran_at >= current_date::timestamptz
   and section like 'section_%'
 group by section, action
 order by section, action;

-- Decommissioned-today list with descriptions for spot-check
select
    eq.equipment_id,
    eq.department,
    eq.description,
    left(eq.notes, 240) as notes_preview
  from public.loto_equipment eq
  join public.loto_hygiene_log hl on hl.equipment_id = eq.equipment_id
 where hl.ran_at >= current_date::timestamptz
   and hl.action = 'decommission'
   and hl.section like 'section_%'
   and eq.decommissioned = true
 group by eq.equipment_id, eq.department, eq.description, eq.notes
 order by eq.department, eq.equipment_id;
