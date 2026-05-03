import { supabase } from '@/lib/supabase'
import { computePhotoStatusFromUrls } from '@/lib/photoStatus'

export type UploadType = 'EQUIP' | 'ISO'

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

// Storage paths must be safe for object-storage keys (no slashes,
// spaces, etc.). Equipment IDs come from CSV imports and have been
// observed to contain '/' and '#' historically; sanitise both the
// folder prefix and the filename component.
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function uploadWithRetry(
  bucket: ReturnType<typeof supabase.storage.from>,
  path: string,
  blob: Blob,
  opts: { contentType: string; upsert: boolean },
): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { error } = await bucket.upload(path, blob, opts)
    if (!error) return
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    } else {
      throw new Error(error.message)
    }
  }
}

export interface UploadPhotoArgs {
  equipmentId: string
  type:        UploadType
  blob:        Blob
  // When true, retry the storage upload up to 3 times with exponential
  // backoff. The live in-app upload sets this; the offline-queue drain
  // does NOT — failed queue items stay in the queue and the next drain
  // trigger (online/focus/visibilitychange) retries them naturally.
  retry?:      boolean
}

export interface UploadPhotoResult {
  publicUrl: string
}

// Single source of truth for the photo upload pipeline used by both:
//  - hooks/usePhotoUpload (live in-app upload, with React state wrapper)
//  - components/UploadQueueProvider (offline-queue drain)
//
// The five-step sequence — upload → SELECT → compute status → UPDATE →
// re-SELECT-and-reconcile — must not drift between the two callers.
// The reconcile step exists because two concurrent uploads (live + queue
// drain on a tablet that just regained connectivity) can race between
// their SELECT and UPDATE; without reconciliation, photo_status can be
// left in a state that doesn't match the actual URL columns.
export async function uploadPhotoForEquipment(
  { equipmentId, type, blob, retry = false }: UploadPhotoArgs,
): Promise<UploadPhotoResult> {
  const sanitized   = sanitizeId(equipmentId)
  const storagePath = `${sanitized}/${sanitized}_${type}_${Date.now()}.jpg`
  const bucket      = supabase.storage.from('loto-photos')

  if (retry) {
    await uploadWithRetry(bucket, storagePath, blob, { contentType: 'image/jpeg', upsert: false })
  } else {
    const { error } = await bucket.upload(storagePath, blob, { contentType: 'image/jpeg', upsert: false })
    if (error) throw new Error(error.message)
  }

  const { data: { publicUrl } } = bucket.getPublicUrl(storagePath)

  // SELECT current URL columns. They are the ground truth for whether a
  // photo exists; boolean flags (has_equip_photo / has_iso_photo) can
  // drift after migrations or manual DB edits, so the derived
  // photo_status is computed from URL presence instead.
  // needs_*_photo flags let us mark "complete" for equipment that only
  // requires one of the two photos.
  const { data: current, error: selectError } = await supabase
    .from('loto_equipment')
    .select('equip_photo_url, iso_photo_url, needs_equip_photo, needs_iso_photo')
    .eq('equipment_id', equipmentId)
    .single()

  if (selectError) throw new Error(selectError.message)

  const newEquipUrl = type === 'EQUIP' ? publicUrl : (current?.equip_photo_url ?? null)
  const newIsoUrl   = type === 'ISO'   ? publicUrl : (current?.iso_photo_url   ?? null)
  const newStatus   = computePhotoStatusFromUrls(
    newEquipUrl,
    newIsoUrl,
    current?.needs_equip_photo,
    current?.needs_iso_photo,
  )

  const urlField = type === 'EQUIP' ? 'equip_photo_url' : 'iso_photo_url'
  const hasField = type === 'EQUIP' ? 'has_equip_photo' : 'has_iso_photo'

  const { error: patchError } = await supabase
    .from('loto_equipment')
    .update({
      [urlField]: publicUrl,
      [hasField]: true,
      photo_status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('equipment_id', equipmentId)

  if (patchError) throw new Error(patchError.message)

  // Reconcile photo_status against the latest URLs in case another
  // upload (live or queued) wrote concurrently between our SELECT + UPDATE.
  const { data: fresh } = await supabase
    .from('loto_equipment')
    .select('equip_photo_url, iso_photo_url, photo_status, needs_equip_photo, needs_iso_photo')
    .eq('equipment_id', equipmentId)
    .single()
  if (fresh) {
    const actualStatus = computePhotoStatusFromUrls(
      fresh.equip_photo_url,
      fresh.iso_photo_url,
      fresh.needs_equip_photo,
      fresh.needs_iso_photo,
    )
    if (fresh.photo_status !== actualStatus) {
      await supabase
        .from('loto_equipment')
        .update({ photo_status: actualStatus, updated_at: new Date().toISOString() })
        .eq('equipment_id', equipmentId)
    }
  }

  return { publicUrl }
}
