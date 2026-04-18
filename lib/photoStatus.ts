import type { Equipment } from './types'

export type PhotoStatus = 'missing' | 'partial' | 'complete'

export function computePhotoStatus(hasEquip: boolean, hasIso: boolean): PhotoStatus {
  if (hasEquip && hasIso) return 'complete'
  if (hasEquip || hasIso) return 'partial'
  return 'missing'
}

// URL-based variant — ground truth is whether the photo URL exists and is non-empty.
// Booleans (has_equip_photo / has_iso_photo) can drift from reality after migrations or
// manual DB edits; this avoids that class of inconsistency.
export function computePhotoStatusFromUrls(
  equipUrl: string | null | undefined,
  isoUrl:   string | null | undefined,
): PhotoStatus {
  const hasEquip = Boolean(equipUrl?.trim())
  const hasIso   = Boolean(isoUrl?.trim())
  return computePhotoStatus(hasEquip, hasIso)
}

export function computePhotoStatusFromEquipment(
  eq: Pick<Equipment, 'equip_photo_url' | 'iso_photo_url'>
): PhotoStatus {
  return computePhotoStatusFromUrls(eq.equip_photo_url, eq.iso_photo_url)
}
