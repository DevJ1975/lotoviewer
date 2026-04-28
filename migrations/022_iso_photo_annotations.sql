-- Migration 022: Annotations for the isolation photo.
--
-- Why: migration 015 added overlay arrows + labels for the equipment
-- photo. Field workers also need to call out specific isolation points
-- on the iso_photo_url image — "this disconnect", "that valve" — so the
-- placard tells the same story whether you're looking at the equipment
-- shot or the isolation shot. Mirrors 015 exactly; separate column so
-- the two photos' overlays don't share state.
--
-- Idempotent.

alter table public.loto_equipment
  add column if not exists iso_annotations jsonb not null default '[]'::jsonb;

alter table public.loto_equipment
  drop constraint if exists iso_annotations_is_array;
alter table public.loto_equipment
  add constraint iso_annotations_is_array
  check (jsonb_typeof(iso_annotations) = 'array');

comment on column public.loto_equipment.iso_annotations is
  'Overlay annotations for the iso_photo_url image. Same schema as annotations (lib/photoAnnotations.ts). Separate column so equipment-photo and isolation-photo overlays are independent.';
