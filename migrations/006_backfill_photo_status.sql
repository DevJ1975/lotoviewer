-- Migration 006: Backfill photo_status to respect needs_*_photo flags
--
-- Symptom we're fixing:
--   Equipment with needs_iso_photo = false (or needs_equip_photo = false)
--   was stuck at 'partial' forever because the app previously computed
--   photo_status based on URL presence alone — "complete" required BOTH
--   URLs regardless of whether both photos were actually required.
--
-- The write path in the app is now fixed (lib/photoStatus.ts respects the
-- needs flags), but existing rows still carry stale photo_status values
-- until their next upload triggers a re-compute. This migration backfills
-- every active row so the dashboard counts and list filters reflect
-- reality immediately.
--
-- Logic mirrors computePhotoStatus() in lib/photoStatus.ts:
--   complete = all REQUIRED slots are filled (required = needs_*_photo true)
--   partial  = at least one photo exists but a required slot is empty
--   missing  = no photos at all
--
-- Decommissioned rows are skipped — their status is irrelevant to live
-- counts and shouldn't be disturbed.
--
-- Idempotent — the WHERE clause guarantees no-op runs leave the table
-- untouched and updated_at is only bumped for rows that actually change.

with recomputed as (
  select
    equipment_id,
    case
      when (not coalesce(needs_equip_photo, true)
             or (equip_photo_url is not null and btrim(equip_photo_url) <> ''))
       and (not coalesce(needs_iso_photo, true)
             or (iso_photo_url   is not null and btrim(iso_photo_url)   <> ''))
        then 'complete'
      when (equip_photo_url is not null and btrim(equip_photo_url) <> '')
        or (iso_photo_url   is not null and btrim(iso_photo_url)   <> '')
        then 'partial'
      else 'missing'
    end as new_status
  from loto_equipment
  where coalesce(decommissioned, false) = false
)
update loto_equipment e
set    photo_status = r.new_status,
       updated_at   = now()
from   recomputed r
where  e.equipment_id = r.equipment_id
  and  e.photo_status is distinct from r.new_status;
