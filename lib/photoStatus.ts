import type { Equipment } from './types'

export type PhotoStatus = 'missing' | 'partial' | 'complete'

// Status is derived from two signals: (a) which photos actually exist and
// (b) which ones the equipment is configured to require (`needs_*_photo`).
// Equipment that only needs one photo reaches "complete" as soon as that
// one is uploaded — the other slot is irrelevant.
//
// The old behavior required BOTH URLs for "complete", so any equipment
// with needs_iso_photo=false (common for simple devices without a placard)
// was stuck at "partial" forever. Respecting the needs flags fixes that
// and aligns the stored status with the `needsPhoto()` filter used by
// the equipment list.
//
// Defaults preserve backward compatibility: callers that don't supply
// needs flags fall back to the previous "both required" behavior.
export function computePhotoStatus(
  hasEquip: boolean,
  hasIso:   boolean,
  needsEquip = true,
  needsIso   = true,
): PhotoStatus {
  const equipSatisfied = !needsEquip || hasEquip
  const isoSatisfied   = !needsIso   || hasIso
  if (equipSatisfied && isoSatisfied) return 'complete'
  if (hasEquip || hasIso) return 'partial'
  return 'missing'
}

// URL-based variant — ground truth is whether the photo URL exists and is non-empty.
// Booleans (has_equip_photo / has_iso_photo) can drift from reality after migrations or
// manual DB edits; this avoids that class of inconsistency.
export function computePhotoStatusFromUrls(
  equipUrl:   string | null | undefined,
  isoUrl:     string | null | undefined,
  needsEquip = true,
  needsIso   = true,
): PhotoStatus {
  const hasEquip = Boolean(equipUrl?.trim())
  const hasIso   = Boolean(isoUrl?.trim())
  return computePhotoStatus(hasEquip, hasIso, needsEquip, needsIso)
}

export function computePhotoStatusFromEquipment(
  eq: Pick<Equipment, 'equip_photo_url' | 'iso_photo_url' | 'needs_equip_photo' | 'needs_iso_photo'>
): PhotoStatus {
  return computePhotoStatusFromUrls(
    eq.equip_photo_url,
    eq.iso_photo_url,
    eq.needs_equip_photo,
    eq.needs_iso_photo,
  )
}
