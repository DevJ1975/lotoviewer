'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/nextjs'
import { uploadPhotoForEquipment, type UploadType } from '@/lib/photoUpload'
import {
  clearQueue,
  enqueueUpload,
  getAllQueued,
  removeFromQueue,
  type QueuedUpload,
} from '@/lib/uploadQueue'

interface QueueContextValue {
  queue:        QueuedUpload[]
  queueCount:   number
  queuedKeys:   Set<string>   // "{equipmentId}:{type}" for quick lookup
  syncing:      boolean
  enqueue:      (args: { equipmentId: string; type: UploadType; blob: Blob }) => Promise<void>
  syncNow:      () => Promise<{ ok: number; failed: number }>
  clearAll:     () => Promise<void>
  refresh:      () => Promise<void>
}

const noop = async () => {}

const DEFAULTS: QueueContextValue = {
  queue:      [],
  queueCount: 0,
  queuedKeys: new Set(),
  syncing:    false,
  enqueue:    noop,
  syncNow:    async () => ({ ok: 0, failed: 0 }),
  clearAll:   noop,
  refresh:    noop,
}

const Ctx = createContext<QueueContextValue>(DEFAULTS)

export function useUploadQueue(): QueueContextValue {
  return useContext(Ctx)
}

async function uploadOne(item: QueuedUpload): Promise<void> {
  // No retry on queue drain — failed items stay queued and the next
  // drain trigger (online / focus / visibilitychange) retries them.
  await uploadPhotoForEquipment({
    equipmentId: item.equipmentId,
    type:        item.type,
    blob:        item.blob,
    retry:       false,
  })
}

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue]     = useState<QueuedUpload[]>([])
  const [syncing, setSyncing] = useState(false)
  const syncingRef            = useRef(false)

  const refresh = useCallback(async () => {
    const items = await getAllQueued()
    setQueue(items)
  }, [])

  const enqueue = useCallback(async (args: { equipmentId: string; type: UploadType; blob: Blob }) => {
    await enqueueUpload(args)
    await refresh()
  }, [refresh])

  const clearAll = useCallback(async () => {
    await clearQueue()
    await refresh()
  }, [refresh])

  const syncNow = useCallback(async () => {
    if (syncingRef.current) return { ok: 0, failed: 0 }
    syncingRef.current = true
    setSyncing(true)
    let ok = 0, failed = 0
    try {
      const items = await getAllQueued()
      for (const item of items) {
        try {
          await uploadOne(item)
          await removeFromQueue(item.id)
          ok++
        } catch (err) {
          failed++
          // Leave in queue on failure. Log the actual cause so field users can
          // tell us what's blocking uploads without needing a dev to repro,
          // and capture to Sentry so we see drain failures in aggregate.
          Sentry.captureException(err, {
            tags:  { source: 'upload-queue', stage: 'sync' },
            extra: { equipmentId: item.equipmentId, type: item.type },
          })
          console.error('[upload-queue] sync failed', {
            equipmentId: item.equipmentId,
            type:        item.type,
            error:       err,
            message:     err instanceof Error ? err.message : String(err),
          })
        }
      }
      await refresh()
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
    return { ok, failed }
  }, [refresh])

  // Initial load + drain triggers. iOS Safari has no Background Sync API,
  // so we lean on every "the user is back" signal we can:
  //   - online        → just got connectivity back
  //   - focus         → switched back to this tab
  //   - visibilitychange → standalone PWA returned to foreground (iPad wake)
  // Each event tries to drain the queue. syncNow is a no-op if empty or
  // already syncing, so the duplicate triggers are cheap.
  useEffect(() => {
    refresh()
    const drain = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      syncNow()
    }
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') drain()
    }
    window.addEventListener('online',  drain)
    window.addEventListener('focus',   drain)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('online',  drain)
      window.removeEventListener('focus',   drain)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, syncNow])

  const queuedKeys = new Set(queue.map(q => `${q.equipmentId}:${q.type}`))

  return (
    <Ctx.Provider value={{
      queue,
      queueCount: queue.length,
      queuedKeys,
      syncing,
      enqueue,
      syncNow,
      clearAll,
      refresh,
    }}>
      {children}
    </Ctx.Provider>
  )
}
