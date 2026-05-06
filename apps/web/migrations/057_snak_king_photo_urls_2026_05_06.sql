-- Migration 057: Snak King — populate loto_equipment photo URLs.
--
-- Source: Snak_King_LOTO_Photo_URL_Update_2026-05-06.sql (generated
-- 2026-05-06T16:27:07 from the Renamed Photos library against
-- LOTO_Equipment_Export_2026-05-06.csv). The full 598-UPDATE script
-- lives in the operator's handoff folder and is treated as an
-- auto-generated artifact — re-running the generator on a future
-- photo library produces a different set, so versioning today's
-- snapshot in git has limited durability value.
--
-- This file holds the migration's *durable* parts:
--   1. The audit-log entry (corrected to match loto_hygiene_log's
--      live schema — the upstream INSERT used wrong column names).
--   2. The verification query.
-- The 598 UPDATEs themselves were applied via the Supabase MCP
-- `apply_migration` tool under the same migration name, so they
-- are recorded in `supabase_migrations.schema_migrations` and the
-- `loto_hygiene_log` row inserted below.
--
-- Apply order:
--   * Migration 053 added cs_auto_cancel_trigger (already in main).
--   * Migration 054 = data_hygiene_snak_king_2026_05_06 (applied).
--   * Migration 055 = function_hardening_055 (applied).
--   * Migration 056 = storage_bucket_listing_lockdown_056 (applied).
--   * Migration 057 = THIS file. Apply only AFTER `upload_loto_photos.py`
--     has populated the loto-photos bucket — the UPDATEs write
--     public URLs that 404 if the underlying JPGs are missing.
--
-- Coverage produced by the 598 UPDATEs:
--   Both EQ + IP photos: 430 rows  →  photo_status = 'complete'
--   EQ only:             135 rows  →  photo_status = 'partial'
--   IP only:              33 rows  →  photo_status = 'partial'
--
-- Equipment-id prefixes touched (active rows only after migration 054):
--   302-MX-*, 321-MX-*, BGGN-*, CONVEYOR-*, DEMO-*,
--   JECA-*, JECL-*, JEGN-*, JEPK-*, JEPL-*, LANLEY-OVEN,
--   SHGN-*, SKAP-*, SKCC-*, SKKC-*, SKPC-*, SKPF-*, SKPI-*,
--   SKPK-*, SKPO-*, SKT1-*, SKT2-*, SNK-*, USGN-*, USPK-*,
--   VRC #2, VRC #4
--
-- ~16 UPDATEs target IDs decommissioned by migration 054 (SKPI-100/120/
-- 140/160/180/500-1/500-2/520/540/560/580/600/620, JEGN-500/510/880,
-- SKPC-200/500, USPK-502/503). Each carries `AND decommissioned = false`
-- so they are intentional no-ops — kept in the source for traceability.

BEGIN;

-- 1. Audit-log entry. The upstream script used columns that don't
-- exist on loto_hygiene_log (equipment_ids, performed_at, performed_by);
-- this corrected version matches the live schema (ran_at, section,
-- equipment_id, action, reason, detail JSONB).

INSERT INTO loto_hygiene_log (ran_at, section, equipment_id, action, reason, detail)
VALUES (
  NOW(),
  'photo_url_update_2026_05_06',
  'BATCH',
  'PHOTO_URL_UPDATE',
  'Populating equip_photo_url + iso_photo_url from Renamed Photos library (2026-05-06)',
  jsonb_build_object(
    'performed_by',   'jamil@trainovations.com',
    'total_updates',  598,
    'both_eq_ip',     430,
    'eq_only',        135,
    'ip_only',         33,
    'source_file',    'Snak_King_LOTO_Photo_URL_Update_2026-05-06.sql',
    'source_export',  'LOTO_Equipment_Export_2026-05-06.csv'
  )
);

-- 2. The 598 UPDATE statements run here at apply time. They live in
-- the handoff folder rather than this file (see header note).

-- 3. Post-apply verification — run after the UPDATEs to confirm
-- the photo_status distribution matches expectations.

SELECT photo_status, COUNT(*) AS n
FROM loto_equipment
WHERE decommissioned = false
GROUP BY photo_status
ORDER BY photo_status;

COMMIT;
