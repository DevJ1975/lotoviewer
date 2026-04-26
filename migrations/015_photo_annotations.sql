-- Migration 015: Photo annotations on LOTO placard photos.
--
-- Why: Brady's killer placard feature is the ability to annotate the
-- equipment photo with arrows pointing at each disconnect / valve /
-- isolation point. Workers learn LOTO from the photo, not from the
-- text. We have the photo storage; we just need a way to overlay
-- arrows + labels on it.
--
-- Implementation: a single `annotations` jsonb column on loto_equipment
-- holding an array of shapes. Shapes are stored with relative (0-1)
-- coordinates so they survive image resizing and pixel-density changes.
-- See lib/photoAnnotations.ts for the validated shape schema.
--
-- Idempotent.

alter table public.loto_equipment
  add column if not exists annotations jsonb not null default '[]'::jsonb;

-- Sanity check: must be an array. Anything else (object, null) breaks
-- the renderer's `for (const shape of annotations)` loop. The default
-- catches new rows; this constraint catches edits that go around the app.
alter table public.loto_equipment
  drop constraint if exists annotations_is_array;
alter table public.loto_equipment
  add constraint annotations_is_array
  check (jsonb_typeof(annotations) = 'array');

comment on column public.loto_equipment.annotations is
  'Overlay annotations for the equip_photo_url image. Array of shapes with relative (0-1) coordinates so they scale with the rendered photo. See lib/photoAnnotations.ts for the schema.';
