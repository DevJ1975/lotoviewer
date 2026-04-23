'use client'

import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { computePhotoStatusFromUrls } from '@/lib/photoStatus'

export type UploadType = 'EQUIP' | 'ISO'
export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

async function retryStorageUpload(
  bucket: ReturnType<typeof supabase.storage.from>,
  path: string,
  file: File,
  opts: { contentType: string; upsert: boolean },
): Promise<void> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { error } = await bucket.upload(path, file, opts)
    if (!error) return
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
    } else {
      throw new Error(error.message)
    }
  }
}

export function usePhotoUpload(equipmentId: string, type: UploadType) {
  const [status, setStatus]     = useState<UploadStatus>('idle')
  const [url, setUrl]           = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [attempt, setAttempt]   = useState(0)

  // Caller passes an already-compressed File (see PlacardPhotoSlot) — the
  // hook does not re-compress. Re-compressing would double-encode and
  // degrade quality for no gain since the caller needs a compressed blob
  // anyway for the offline upload queue.
  const upload = useCallback(async (file: File): Promise<string | null> => {
    setStatus('uploading')
    setErrorMsg(null)
    setAttempt(a => a + 1)

    try {
      const sanitized   = equipmentId.replace(/[^a-zA-Z0-9_-]/g, '_')
      const timestamp   = Date.now()
      const storagePath = `${sanitized}/${equipmentId}_${type}_${timestamp}.jpg`
      const bucket      = supabase.storage.from('loto-photos')

      await retryStorageUpload(bucket, storagePath, file, { contentType: 'image/jpeg', upsert: false })

      const { data: { publicUrl } } = bucket.getPublicUrl(storagePath)

      // Query the URL columns — they are the ground truth for whether a photo exists.
      // Boolean flags (has_equip_photo / has_iso_photo) can drift after migrations or
      // manual DB edits, so status is derived from actual URL presence instead.
      // needs_*_photo flags let us mark "complete" for equipment that only requires
      // one of the two photos.
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

      setUrl(publicUrl)
      setStatus('success')
      return publicUrl
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrorMsg(msg)
      setStatus('error')
      return null
    }
  }, [equipmentId, type])

  const reset = useCallback(() => {
    setStatus('idle')
    setUrl(null)
    setErrorMsg(null)
  }, [])

  return { upload, status, url, errorMsg, reset, attempt }
}
