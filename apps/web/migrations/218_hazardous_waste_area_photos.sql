-- Migration 218: Accumulation-area reference photos.
--
-- Tenants want a photo record of each accumulation area itself — the
-- signage, layout, secondary containment, spill kit / eyewash location,
-- and aisle access — not just per-inspection evidence (migration 212).
-- These are durable reference photos attached to the area row.
--
-- Mirrors migration 212: a photo_urls array on the existing, RLS-protected
-- row rather than a child table (the read pattern is always "show me this
-- area's photos"). Photos live in the loto-photos bucket under
--   <tenant_uuid>/hazardous-waste/areas/<area_id>/<ts>.jpg
-- (see packages/core/src/storagePaths.ts -> hazWasteAreaPhotoPath). Migration
-- 033's tenant-UUID-prefix storage RLS already gates writes, so no
-- storage-policy change is needed. Additive column on an existing
-- RLS-protected table — the area's own policies already govern reads/writes.

alter table public.hazardous_waste_areas
  add column if not exists photo_urls text[] not null default '{}';

comment on column public.hazardous_waste_areas.photo_urls is
  'Reference photo public URLs (loto-photos bucket): area signage, layout, containment, spill-kit/eyewash location, aisle access. Distinct from per-inspection evidence photos (hazardous_waste_inspections.photo_urls).';
