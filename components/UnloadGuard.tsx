'use client'

import { useEffect } from 'react'
import { useUploadQueue } from '@/components/UploadQueueProvider'

// Warns the user before they close the tab or navigate away if there are
// uploads still queued. iPad standalone-PWA users rarely "close the tab" but
// they do swipe-up to exit — and Safari treats that path identically. The
// dialog text is browser-controlled in modern browsers; we just opt in.
export default function UnloadGuard() {
  const { queueCount, syncing } = useUploadQueue()

  useEffect(() => {
    if (queueCount === 0 && !syncing) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      // Older browsers required a returnValue; modern ones display a
      // generic message regardless.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [queueCount, syncing])

  return null
}
