// IndexedDB-backed queue for photo uploads that happen while offline or
// fail mid-upload. Items are drained to Supabase Storage when the app
// comes back online or the user clicks "Sync Now".

const DB_NAME    = 'loto_upload_queue'
const DB_VERSION = 1
const STORE      = 'uploads'

export interface QueuedUpload {
  id:          string
  equipmentId: string
  type:        'EQUIP' | 'ISO'
  blob:        Blob
  createdAt:   number
  // Tenant the upload was queued in — used by the drain to pick the
  // storage prefix. Required since Phase 5; the back-compat handling
  // for missing tenantId in UploadQueueProvider drops such items so
  // they never silently route to the wrong tenant.
  tenantId:    string
}

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

function makeId(): string {
  // Simple unique id — doesn't need to be cryptographic
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function enqueueUpload(entry: Omit<QueuedUpload, 'id' | 'createdAt'>): Promise<string> {
  const db = await openDb()
  const id = makeId()
  const record: QueuedUpload = { ...entry, id, createdAt: Date.now() }
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(record)
    req.onsuccess = () => resolve(id)
    req.onerror   = () => reject(req.error)
  })
}

export async function getAllQueued(): Promise<QueuedUpload[]> {
  if (!isIndexedDBAvailable()) return []
  try {
    const db = await openDb()
    return await new Promise<QueuedUpload[]>((resolve, reject) => {
      const req = tx(db, 'readonly').getAll()
      req.onsuccess = () => resolve((req.result as QueuedUpload[]).sort((a, b) => a.createdAt - b.createdAt))
      req.onerror   = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

export async function clearQueue(): Promise<void> {
  if (!isIndexedDBAvailable()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, 'readwrite').clear()
      req.onsuccess = () => resolve()
      req.onerror   = () => reject(req.error)
    })
  } catch {
    /* ignore */
  }
}
