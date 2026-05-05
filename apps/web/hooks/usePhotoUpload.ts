'use client'

import { useState, useCallback } from 'react'
import { uploadPhotoForEquipment, type UploadType } from '@soteria/core/photoUpload'
import { useTenant } from '@/components/TenantProvider'

export type { UploadType }
export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

// Thin React-state wrapper around lib/photoUpload's pipeline. The pipeline
// itself (storage upload + reconcile) is shared with UploadQueueProvider
// so a fix to either path lands in both.
export function usePhotoUpload(equipmentId: string, type: UploadType) {
  const { tenantId } = useTenant()
  const [status, setStatus]     = useState<UploadStatus>('idle')
  const [url, setUrl]           = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [attempt, setAttempt]   = useState(0)

  // Caller passes an already-compressed File (see PlacardPhotoSlot) — the
  // hook does not re-compress. Re-compressing would double-encode and
  // degrade quality for no gain since the caller needs a compressed blob
  // anyway for the offline upload queue.
  const upload = useCallback(async (file: File): Promise<string | null> => {
    if (!tenantId) {
      setErrorMsg('No active tenant')
      setStatus('error')
      return null
    }
    setStatus('uploading')
    setErrorMsg(null)
    setAttempt(a => a + 1)

    try {
      const { publicUrl } = await uploadPhotoForEquipment({
        equipmentId,
        type,
        blob: file,
        tenantId,
        retry: true,
      })
      setUrl(publicUrl)
      setStatus('success')
      return publicUrl
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setErrorMsg(msg)
      setStatus('error')
      return null
    }
  }, [equipmentId, type, tenantId])

  const reset = useCallback(() => {
    setStatus('idle')
    setUrl(null)
    setErrorMsg(null)
  }, [])

  return { upload, status, url, errorMsg, reset, attempt }
}
