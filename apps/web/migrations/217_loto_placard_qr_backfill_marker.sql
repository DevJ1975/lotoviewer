-- Migration 217: resumable backfill marker for LOTO placard regeneration.
--
-- #194 added the tenant logo + per-machine QR code to generated placards,
-- but only NEW renders pick that up. The existing fleet is stale in two
-- ways: the handful of rows with a stored `placard_url` hold pre-logo PDFs,
-- and most active equipment has no stored placard at all — so the print
-- queue (which serves `placard_url`) silently drops them from "download
-- all". Re-rendering every active machine once fixes both.
--
-- This column drives the resumable backfill cron
-- (`/api/cron/regenerate-loto-placards`): it re-renders each active
-- machine's placard (logo + QR) in time-bounded batches, flipping the row
-- to true so re-runs skip it. Default false => the whole existing fleet is
-- queued; any future insert is queued the same way and drained on the next
-- pass.
--
-- Additive + idempotent: safe to re-run.

alter table public.loto_equipment
  add column if not exists placard_qr_backfilled boolean not null default false;

-- Partial index for the cron's hot query: un-backfilled, still-active rows.
-- `is not true` keeps rows whose decommissioned flag is false OR null. The
-- index stays tiny once the backfill drains (only future inserts remain).
create index if not exists loto_equipment_placard_backfill_idx
  on public.loto_equipment (tenant_id, equipment_id)
  where placard_qr_backfilled = false and decommissioned is not true;
