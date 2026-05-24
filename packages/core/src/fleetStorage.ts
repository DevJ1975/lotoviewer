// Object-key builders for the private `fleet-docs` storage bucket.
//
// Migration 199's RLS requires every key's first segment to be the tenant
// UUID (via storage_path_tenant). Centralizing path construction here keeps
// the layout in one place. All builders return the object KEY (no bucket
// prefix); callers do:
//   supabase.storage.from('fleet-docs').upload(vehiclePhotoPath(...), blob)

export const FLEET_BUCKET = 'fleet-docs'

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function ext(fileName: string): string {
  const m = /\.([a-zA-Z0-9]+)$/.exec(fileName)
  return m ? m[1].toLowerCase() : 'bin'
}

// Vehicle photo (one current photo per vehicle; timestamped so re-uploads
// don't collide while the old object is cleaned up out of band).
//   fleet-docs/<tenant_uuid>/vehicles/<vehicle_id>/photo_<ts>.<ext>
export function vehiclePhotoPath(
  tenantId: string,
  vehicleId: string,
  fileName: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/vehicles/${sanitize(vehicleId)}/photo_${timestamp}.${ext(fileName)}`
}

// Scanned vehicle document (insurance, registration, DOT inspection, …).
//   fleet-docs/<tenant_uuid>/vehicles/<vehicle_id>/docs/<doc_type>_<ts>.<ext>
export function vehicleDocumentPath(
  tenantId: string,
  vehicleId: string,
  docType: string,
  fileName: string,
  timestamp: number = Date.now(),
): string {
  return `${tenantId}/vehicles/${sanitize(vehicleId)}/docs/${sanitize(docType)}_${timestamp}.${ext(fileName)}`
}
