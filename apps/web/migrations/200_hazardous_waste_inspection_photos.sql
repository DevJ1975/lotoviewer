-- Migration 200: Hazardous-waste inspection evidence photos.
--
-- RCRA weekly accumulation-area inspections (40 CFR 262.16 / 262.17) turn
-- on what the inspector sees: lids closed, labels legible & dated,
-- container integrity, secondary containment, aisle space, signage. The
-- defensible record of a finding is a photo taken in the field.
--
-- Inspections are submitted in one shot from the field form, so photos
-- are stored as a URL array on the inspection row (mirroring
-- wah_inspections.photo_urls, migration 188) rather than a child table —
-- the read pattern is always "show me this inspection's photos", never a
-- cross-inspection photo query.
--
-- Photos live in the loto-photos bucket under
--   <tenant_uuid>/hazardous-waste/inspections/<draft_id>/<ts>.jpg
-- (see packages/core/src/storagePaths.ts -> hazWasteInspectionPhotoPath).
-- Migration 033's tenant-UUID-prefix storage RLS already gates writes, so
-- no storage-policy change is needed. Additive column on an existing
-- RLS-protected table — the inspection's own policies already govern reads
-- and writes of this column.

alter table public.hazardous_waste_inspections
  add column if not exists photo_urls text[] not null default '{}';

comment on column public.hazardous_waste_inspections.photo_urls is
  'Field-evidence photo public URLs (loto-photos bucket). RCRA 40 CFR 262.16/262.17 inspection evidence — retained with the inspection for the CUPA binder.';
