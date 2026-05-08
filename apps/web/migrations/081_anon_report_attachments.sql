-- Migration 081: Photo + voice-memo attachments for anonymous reports.
--
-- SUPERSEDED on 2026-05-08. The incident_attachments table already
-- existed in the production schema (created earlier outside the
-- numbered migrations, with columns: id, tenant_id, incident_id,
-- storage_path, mime_type, file_size_bytes, exif_json, caption,
-- uploaded_by, uploaded_at).
--
-- The anonymous-report attach pipeline reuses that table directly.
-- Rows from anonymous reports leave uploaded_by NULL (the public
-- submit endpoint has no JWT) and storage_path follows the convention
--   <tenant_uuid>/anonymous-reports/<incident_id>/<seq>_<ts>.bin
-- inside the existing loto-photos bucket.
--
-- This file is kept as a no-op so the migration sequence stays
-- contiguous and a fresh-database setup still produces a working
-- system if the pre-existing table is ever moved into a numbered
-- migration. Subsequent migrations 082-087 carry real DDL.

begin;
-- intentionally empty
commit;
