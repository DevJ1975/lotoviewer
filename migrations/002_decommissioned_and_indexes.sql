-- Migration 002: decommissioned column + performance indexes
-- Run against your Supabase project in the SQL editor.

-- ── loto_equipment.decommissioned ─────────────────────────────────────────────
-- Retires equipment without deleting it. Referenced by the /decommission page
-- and excluded from sidebar counts, list, status page, status report, CSV export.
alter table public.loto_equipment
  add column if not exists decommissioned boolean not null default false;

-- Partial index: most rows are NOT decommissioned, so this keeps the index small
-- while still making "show retired" queries fast.
create index if not exists loto_equipment_decommissioned_idx
  on public.loto_equipment (decommissioned)
  where decommissioned = true;

-- ── loto_equipment.department ─────────────────────────────────────────────────
-- Filtered on for every dept-scoped view (sidebar, batch print, list panel).
create index if not exists loto_equipment_department_idx
  on public.loto_equipment (department);

-- ── loto_reviews (department, created_at desc) ────────────────────────────────
-- Composite index to serve "latest approved review per department" without a
-- sort step. Supersedes the standalone created_at index from migration 001 for
-- this access pattern; the old index is kept since it still helps global
-- time-range scans.
create index if not exists loto_reviews_department_created_at_idx
  on public.loto_reviews (department, created_at desc);
