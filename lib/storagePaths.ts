// Single source of truth for `loto-photos` storage paths. Migration 033's
// RLS requires every path's first segment to be a tenant UUID; centralizing
// path construction here means a future layout change is one file edit
// rather than a hunt across hooks/components/pages.
//
// All paths return the *object key* (no bucket prefix). Callers do
//   supabase.storage.from('loto-photos').upload(equipmentPhotoPath(...), blob)

// Object keys must be safe (no slashes/spaces in any segment except the
// path separator). Equipment + space IDs come from CSV imports and have
// historically contained '/' and '#'.
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export type PhotoSlot = 'EQUIP' | 'ISO'

// Equipment placard photo (live upload + offline-queue drain).
//   loto-photos/<tenant_uuid>/<sanitized_id>/<sanitized_id>_<EQUIP|ISO>_<ts>.jpg
export function equipmentPhotoPath(
  tenantId: string,
  equipmentId: string,
  slot: PhotoSlot,
  timestamp: number = Date.now(),
): string {
  const id = sanitizeId(equipmentId)
  return `${tenantId}/${id}/${id}_${slot}_${timestamp}.jpg`
}

// Generated placard PDF — one per equipment, overwritten on regenerate.
//   loto-photos/<tenant_uuid>/<sanitized_id>/<sanitized_id>_placard.pdf
export function placardPdfPath(tenantId: string, equipmentId: string): string {
  const id = sanitizeId(equipmentId)
  return `${tenantId}/${id}/${id}_placard.pdf`
}

// Signed placard PDF after department reviewer signs.
//   loto-photos/<tenant_uuid>/signed-placards/<sanitized_id>_<ts>.pdf
export function signedPlacardPath(
  tenantId: string,
  equipmentId: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/signed-placards/${sanitizeId(equipmentId)}_${timestamp}.pdf`
}

// Confined-space photo (interior / exterior slot per space).
//   loto-photos/<tenant_uuid>/confined-spaces/<sanitized_space_id>/<slot>_<ts>.jpg
export function confinedSpacePhotoPath(
  tenantId: string,
  spaceId: string,
  slot: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/confined-spaces/${sanitizeId(spaceId)}/${slot}_${timestamp}.jpg`
}
