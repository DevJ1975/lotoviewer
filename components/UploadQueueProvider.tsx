'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { computePhotoStatusFromUrls } from '@/lib/photoStatus'
import {
  clearQueue,
  enqueueUpload,
  getAllQueued,
  removeFromQueue,
  type QueuedUpload,
} from '@/lib/uploadQueue'

type UploadType = 'EQUIP' | 'ISO'

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

function sanitize(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function uploadOne(item: QueuedUpload): Promise<void> {
  const sanitized = sanitize(item.equipmentId)
  const path = `${sanitized}/${sanitized}_${item.type}_${Date.now()}.jpg`
  const bucket = supabase.storage.from('loto-photos')

  const { error: upErr } = await bucket.upload(path, item.blob, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(upErr.message)

  const { data: { publicUrl } } = bucket.getPublicUrl(path)

  const { data: current, error: selErr } = await supabase
    .from('loto_equipment')
    .select('equip_photo_url, iso_photo_url')
    .eq('equipment_id', item.equipmentId)
    .single()
  if (selErr) throw new Error(selErr.message)

  const newEquipUrl = item.type === 'EQUIP' ? publicUrl : current?.equip_photo_url ?? null
  const newIsoUrl   = item.type === 'ISO'   ? publicUrl : current?.iso_photo_url   ?? null
  const newStatus   = computePhotoStatusFromUrls(newEquipUrl, newIsoUrl)

  const urlField = item.type === 'EQUIP' ? 'equip_photo_url' : 'iso_photo_url'
  const hasField = item.type === 'EQUIP' ? 'has_equip_photo' : 'has_iso_photo'

  const { error: patchErr } = await supabase
    .from('loto_equipment')
    .update({
      [urlField]: publicUrl,
      [hasField]: true,
      photo_status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('equipment_id', item.equipmentId)
  if (patchErr) throw new Error(patchErr.message)

  // Reconcile: re-read URLs and correct photo_status if another concurrent
  // upload (live or queue) wrote between our SELECT and UPDATE.
  const { data: fresh } = await supabase
    .from('loto_equipment')
    .select('equip_photo_url, iso_photo_url, photo_status')
    .eq('equipment_id', item.equipmentId)
    .single()
  if (fresh) {
    const actualStatus = computePhotoStatusFromUrls(fresh.equip_photo_url, fresh.iso_photo_url)
    if (fresh.photo_status !== actualStatus) {
      await supabase
        .from('loto_equipment')
        .update({ photo_status: actualStatus, updated_at: new Date().toISOString() })
        .eq('equipment_id', item.equipmentId)
    }
  }
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
        } catch {
          failed++
          // Leave in queue on failure
        }
      }
      await refresh()
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
    return { ok, failed }
  }, [refresh])

  // Initial load + sync attempt when online events fire
  useEffect(() => {
    refresh()
    function onOnline() { syncNow() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
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
