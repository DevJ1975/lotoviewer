'use client'

import { useEffect } from 'react'
import { acquireWakeLock, type WakeLockHandle } from '@/lib/platform'

// Hold a screen wake lock while `active` is true. Used during long-running
// work (PDF generation, batch uploads, placard signing) so an iPad or iPhone
// screen doesn't dim mid-task.
//
// Unsupported browsers (Safari <16.4, very old Android) get a silent no-op.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    let handle: WakeLockHandle | null = null
    let cancelled = false

    acquireWakeLock().then(h => {
      if (cancelled) { h?.release() } else { handle = h }
    })

    return () => {
      cancelled = true
      handle?.release()
    }
  }, [active])
}
