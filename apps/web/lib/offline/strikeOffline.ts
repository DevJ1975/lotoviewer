// Browser-side companion to public/sw.js. Wraps the SW message protocol
// for the STRIKE offline video cache and keeps cap + LRU metadata in
// IndexedDB. The SW alone cannot decide what to evict — it knows what is
// cached and how big each entry is, but not which module the learner
// touched most recently — so we mirror lastUsedAt here on the page side.
//
// All entry points are safe to call on a server (Next.js dev SSR will
// import this file from the learner page); they return inert empty
// results when window / navigator / indexedDB is unavailable.

import { decideStrikeEvictions } from '@soteria/core/strikeOfflineCap'

const DB_NAME = 'soteria_strike_offline'
const DB_VERSION = 1
const STORE = 'modules'

export const STRIKE_OFFLINE_CAP_KEY = 'soteria.strike.offlineCapMb'
export const STRIKE_OFFLINE_CAP_DEFAULT_MB = 500

export interface StrikeOfflineModuleMeta {
  path: string
  moduleId: string
  versionId: string
  title: string
  sizeBytes: number
  addedAt: number
  lastUsedAt: number
}

interface SWMessage<T> {
  type: T
  [key: string]: unknown
}

interface DownloadResult { ok: true; path: string; size: number }
interface ListResult { ok: true; entries: { path: string; size: number }[]; total: number }
interface HasResult { ok: true; present: boolean }
interface DeleteResult { ok: true; removed: boolean }
interface ErrorResult { ok: false; error: string }

type SWReply<T> = T | ErrorResult

function browser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
}

function indexedDbAvailable(): boolean {
  return browser() && typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!indexedDbAvailable()) { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function putMeta(meta: StrikeOfflineModuleMeta): Promise<void> {
  if (!indexedDbAvailable()) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(meta)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function deleteMeta(path: string): Promise<void> {
  if (!indexedDbAvailable()) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(path)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function listOfflineMetadata(): Promise<StrikeOfflineModuleMeta[]> {
  if (!indexedDbAvailable()) return []
  try {
    const db = await openDb()
    return await new Promise<StrikeOfflineModuleMeta[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as StrikeOfflineModuleMeta[])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export function getOfflineCapMb(): number {
  if (!browser()) return STRIKE_OFFLINE_CAP_DEFAULT_MB
  try {
    const raw = window.localStorage.getItem(STRIKE_OFFLINE_CAP_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? Math.round(n) : STRIKE_OFFLINE_CAP_DEFAULT_MB
  } catch {
    return STRIKE_OFFLINE_CAP_DEFAULT_MB
  }
}

export function setOfflineCapMb(mb: number): void {
  if (!browser()) return
  try { window.localStorage.setItem(STRIKE_OFFLINE_CAP_KEY, String(Math.max(50, Math.round(mb)))) }
  catch { /* private mode etc. */ }
}

function sendToSW<T>(msg: SWMessage<string>): Promise<SWReply<T>> {
  if (!browser() || !('serviceWorker' in navigator)) {
    return Promise.resolve({ ok: false, error: 'No service worker' } as SWReply<T>)
  }
  return new Promise(resolve => {
    navigator.serviceWorker.ready
      .then(reg => {
        const target = reg.active ?? navigator.serviceWorker.controller
        if (!target) { resolve({ ok: false, error: 'Service worker not active' } as SWReply<T>); return }
        const channel = new MessageChannel()
        channel.port1.onmessage = event => {
          resolve((event.data ?? { ok: false, error: 'Empty reply' }) as SWReply<T>)
          channel.port1.close()
        }
        target.postMessage(msg, [channel.port2])
      })
      .catch(err => resolve({ ok: false, error: err instanceof Error ? err.message : String(err) } as SWReply<T>))
  })
}

export interface DownloadStrikeVideoInput {
  path: string
  signedUrl: string
  moduleId: string
  versionId: string
  title: string
}

export interface DownloadStrikeVideoResult {
  ok: boolean
  evicted: StrikeOfflineModuleMeta[]
  error?: string
  sizeBytes?: number
}

// Drives a download: asks the SW to fetch + cache, records metadata, then
// enforces the cap by evicting older entries (LRU). The eviction list is
// returned so the page can surface what was removed.
export async function downloadStrikeVideo(input: DownloadStrikeVideoInput): Promise<DownloadStrikeVideoResult> {
  const reply = await sendToSW<DownloadResult>({
    type: 'STRIKE_DOWNLOAD_VIDEO',
    path: input.path,
    signedUrl: input.signedUrl,
  })
  if (!reply.ok) return { ok: false, evicted: [], error: reply.error }

  const now = Date.now()
  await putMeta({
    path: input.path,
    moduleId: input.moduleId,
    versionId: input.versionId,
    title: input.title,
    sizeBytes: reply.size,
    addedAt: now,
    lastUsedAt: now,
  })

  const evicted = await enforceOfflineCap()
  return { ok: true, evicted, sizeBytes: reply.size }
}

export async function deleteStrikeVideo(path: string): Promise<boolean> {
  const reply = await sendToSW<DeleteResult>({ type: 'STRIKE_DELETE_VIDEO', path })
  await deleteMeta(path)
  return reply.ok && reply.removed
}

export async function isStrikeVideoOffline(path: string): Promise<boolean> {
  const reply = await sendToSW<HasResult>({ type: 'STRIKE_HAS_VIDEO', path })
  return reply.ok && reply.present
}

export async function listOfflineFromSW(): Promise<{ path: string; size: number }[]> {
  const reply = await sendToSW<ListResult>({ type: 'STRIKE_LIST_VIDEOS' })
  if (!reply.ok) return []
  return reply.entries
}

// Update lastUsedAt without re-downloading. Called by the learner page
// when a module's video starts playing so a future eviction round keeps
// what the learner is actively watching.
export async function touchOfflineUsage(path: string): Promise<void> {
  if (!indexedDbAvailable()) return
  try {
    const db = await openDb()
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    const existing = await new Promise<StrikeOfflineModuleMeta | undefined>((resolve, reject) => {
      const req = store.get(path)
      req.onsuccess = () => resolve(req.result as StrikeOfflineModuleMeta | undefined)
      req.onerror = () => reject(req.error)
    })
    if (!existing) return
    existing.lastUsedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      const req = store.put(existing)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    /* metadata is best-effort */
  }
}

// Reads the current cap, sums recorded sizes, evicts least-recently-used
// entries until usage fits. Returns the evicted entries for UI feedback.
export async function enforceOfflineCap(): Promise<StrikeOfflineModuleMeta[]> {
  const capBytes = getOfflineCapMb() * 1024 * 1024
  const all = await listOfflineMetadata()
  const decisions = decideStrikeEvictions({
    capBytes,
    entries: all.map(e => ({ path: e.path, sizeBytes: e.sizeBytes, lastUsedAt: e.lastUsedAt })),
  })
  if (decisions.evictPaths.length === 0) return []
  const evicted: StrikeOfflineModuleMeta[] = []
  for (const path of decisions.evictPaths) {
    const meta = all.find(e => e.path === path)
    if (!meta) continue
    await deleteStrikeVideo(path)
    evicted.push(meta)
  }
  return evicted
}

// Total bytes recorded in metadata. Authoritative source is the SW (the
// cache could disappear after browser cleanup) but the metadata is good
// enough for showing usage in the management UI.
export async function totalOfflineBytes(): Promise<number> {
  const all = await listOfflineMetadata()
  return all.reduce((sum, e) => sum + e.sizeBytes, 0)
}
