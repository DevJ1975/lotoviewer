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

// Staged reviewer photo replacement (public review portal). The reviewer's
// upload is parked here — NOT at the live equipmentPhotoPath — until an
// admin reconciles it into loto_equipment. Keyed by review link so a
// 30-day cleanup cron can sweep staging/ objects with no pending/applied
// row. Service-role uploads only, so the tenant-uuid-first convention
// (migration 033 RLS) does not apply to this prefix.
//   loto-photos/staging/<review_link_id>/<sanitized_id>/<EQUIP|ISO>-<ts>.jpg
export function stagingReviewPhotoPath(
  reviewLinkId: string,
  equipmentId: string,
  slot: PhotoSlot,
  timestamp: number = Date.now(),
): string {
  return `staging/${reviewLinkId}/${sanitizeId(equipmentId)}/${slot}-${timestamp}.jpg`
}

// Watermarked manufacturer/reference ISO placeholder image (migration 217 +
// the multi-agent audit). Attached to the ISO slot when the real isolation
// point can't be confirmed. Tenant-uuid-first so the migration 033 RLS gates
// writes; the _PLACEHOLDER_ infix makes it obvious in the bucket that this is
// NOT a verified field photo.
//   loto-photos/<tenant_uuid>/<sanitized_id>/<sanitized_id>_ISO_PLACEHOLDER_<ts>.jpg
export function placeholderIsoPhotoPath(
  tenantId: string,
  equipmentId: string,
  timestamp: number = Date.now(),
): string {
  const id = sanitizeId(equipmentId)
  return `${tenantId}/${id}/${id}_ISO_PLACEHOLDER_${timestamp}.jpg`
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

// §147(c)(6) walkdown checklist per-item photo evidence.
//   loto-photos/<tenant_uuid>/walkdowns/<sanitized_equipment_id>/<item_id>_<ts>.jpg
export function walkdownPhotoPath(
  tenantId: string,
  equipmentId: string,
  itemId: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/walkdowns/${sanitizeId(equipmentId)}/${sanitizeId(itemId)}_${timestamp}.jpg`
}

// Hot work permit area-condition photo (OSHA 1910.252 / NFPA 51B).
// One permit can carry several, so the permit_id folder groups them.
//   loto-photos/<tenant_uuid>/hot-work/<sanitized_permit_id>/<ts>.jpg
export function hotWorkPhotoPath(
  tenantId: string,
  permitId: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/hot-work/${sanitizeId(permitId)}/${timestamp}.jpg`
}

// Hazardous-waste inspection evidence photo (RCRA 40 CFR 262.16/262.17).
// An inspection is submitted in one shot from the field form, so photos are
// uploaded against a client-generated draft id (the inspection row does not
// exist yet) and the resolved URLs are saved on the row's photo_urls[].
//   loto-photos/<tenant_uuid>/hazardous-waste/inspections/<draft_id>/<ts>.jpg
export function hazWasteInspectionPhotoPath(
  tenantId: string,
  draftId: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/hazardous-waste/inspections/${sanitizeId(draftId)}/${timestamp}.jpg`
}

// EM-385 compliance evidence document (APP, AHA, plans, certs, permits, …).
// One register item can carry several versions, so the register_item_id folder
// groups them. Tenant-uuid-first so the migration 033 RLS gates writes.
//   loto-photos/<tenant_uuid>/em385/<sanitized_register_item_id>/<ts>_<sanitized_file_name>
export function em385DocumentPath(
  tenantId: string,
  registerItemId: string,
  fileName: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/em385/${sanitizeId(registerItemId)}/${timestamp}_${sanitizeId(fileName)}`
}

// Cal. Code Regs tit. 27 §25602 — photo of the actual posted Prop 65
// sign. Stored under prop65/<tenant>/warning_photos/<site_id>/<ts>.jpg
// so the tenant-scoped RLS (migration 033) gates writes.
//   loto-photos/<tenant_uuid>/prop65/warning_photos/<sanitized_site_id>/<ts>.jpg
export function prop65WarningPhotoPath(
  tenantId: string,
  siteId: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/prop65/warning_photos/${sanitizeId(siteId)}/${timestamp}.jpg`
}
