'use client'

import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { compressImage } from '@/lib/imageUtils'
import { computePhotoStatusFromUrls } from '@/lib/photoStatus'

export type UploadType = 'EQUIP' | 'ISO'
export type UploadStatus = 'idle' | 'compressing' | 'uploading' | 'success' | 'error'

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

  const upload = useCallback(async (file: File): Promise<string | null> => {
    setStatus('compressing')
    setErrorMsg(null)
    setAttempt(a => a + 1)

    try {
      const compressed  = await compressImage(file, 1_000_000)

      setStatus('uploading')

      const sanitized   = equipmentId.replace(/[^a-zA-Z0-9_-]/g, '_')
      const timestamp   = Date.now()
      const storagePath = `${sanitized}/${equipmentId}_${type}_${timestamp}.jpg`
      const bucket      = supabase.storage.from('loto-photos')

      await retryStorageUpload(bucket, storagePath, compressed, { contentType: 'image/jpeg', upsert: false })

      const { data: { publicUrl } } = bucket.getPublicUrl(storagePath)

      // Query the URL columns — they are the ground truth for whether a photo exists.
      // Boolean flags (has_equip_photo / has_iso_photo) can drift after migrations or
      // manual DB edits, so status is derived from actual URL presence instead.
      const { data: current, error: selectError } = await supabase
        .from('loto_equipment')
        .select('equip_photo_url, iso_photo_url')
        .eq('equipment_id', equipmentId)
        .single()

      if (selectError) throw new Error(selectError.message)

      const newEquipUrl = type === 'EQUIP' ? publicUrl : (current?.equip_photo_url ?? null)
      const newIsoUrl   = type === 'ISO'   ? publicUrl : (current?.iso_photo_url   ?? null)
      const newStatus   = computePhotoStatusFromUrls(newEquipUrl, newIsoUrl)

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
