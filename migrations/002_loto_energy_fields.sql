-- Energy tag and LOTO procedure fields for equipment detail page
ALTER TABLE loto_equipment
  ADD COLUMN IF NOT EXISTS energy_tag          text,
  ADD COLUMN IF NOT EXISTS iso_description     text,
  ADD COLUMN IF NOT EXISTS iso_procedure       text,
  ADD COLUMN IF NOT EXISTS lockout_device      text,
  ADD COLUMN IF NOT EXISTS verification_method text;
