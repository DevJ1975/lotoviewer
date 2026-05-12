// IndexedDB-backed queue for STRIKE quiz submissions that happen while
// the device is offline. Items are drained against /api/strike/[moduleId]
// /submit when the browser regains connectivity, or on the next page
// load where the learner is signed in.
//
// Mirrors lib/uploadQueue.ts (photos) but keeps a separate DB so quiz
// retries and photo retries cannot starve each other.

const DB_NAME = 'soteria_strike_queue'
const DB_VERSION = 1
const STORE = 'attempts'

export interface QueuedStrikeAttempt {
  id: string
  moduleId: string
  tenantId: string
  // Exact JSON body the page would have POSTed to /api/strike/[id]/submit.
  // Stored verbatim so a future schema bump on the page side doesn't lose
  // an in-flight attempt's payload.
  body: Record<string, unknown>
  createdAt: number
  attempts: number
  lastError?: string
}

function indexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!indexedDbAvailable()) { reject(new Error('IndexedDB unavailable')); return }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function enqueueStrikeAttempt(
  entry: Omit<QueuedStrikeAttempt, 'id' | 'createdAt' | 'attempts'>,
): Promise<string> {
  if (!indexedDbAvailable()) throw new Error('IndexedDB unavailable')
  const db = await openDb()
  const id = makeId()
  const record: QueuedStrikeAttempt = { ...entry, id, createdAt: Date.now(), attempts: 0 }
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).add(record)
    req.onsuccess = () => resolve(id)
    req.onerror = () => reject(req.error)
  })
}

export async function listQueuedAttempts(): Promise<QueuedStrikeAttempt[]> {
  if (!indexedDbAvailable()) return []
  try {
    const db = await openDb()
    return await new Promise<QueuedStrikeAttempt[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result as QueuedStrikeAttempt[]).sort((a, b) => a.createdAt - b.createdAt))
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function removeQueuedAttempt(id: string): Promise<void> {
  if (!indexedDbAvailable()) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function markRetried(item: QueuedStrikeAttempt, lastError?: string): Promise<void> {
  if (!indexedDbAvailable()) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put({
      ...item,
      attempts: item.attempts + 1,
      lastError,
    } satisfies QueuedStrikeAttempt)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export interface FlushResult {
  flushed: number
  failed: number
  remaining: number
}

export interface FlushOptions {
  // Caller provides the bearer (Supabase session access token) so this
  // module stays unaware of the auth provider.
  getAccessToken: () => Promise<string | null>
}

// Drains queued attempts in arrival order. Stops on the first network
// error so we don't burn through a stack of offline submissions when the
// network is still flaky; HTTP errors bump the attempts counter but
// continue. Successful submissions are removed.
export async function flushStrikeQueue(options: FlushOptions): Promise<FlushResult> {
  if (!indexedDbAvailable()) return { flushed: 0, failed: 0, remaining: 0 }
  const items = await listQueuedAttempts()
  if (items.length === 0) return { flushed: 0, failed: 0, remaining: 0 }
  const token = await options.getAccessToken()
  if (!token) return { flushed: 0, failed: 0, remaining: items.length }

  let flushed = 0
  let failed = 0
  for (const item of items) {
    try {
      const res = await fetch(`/api/strike/${item.moduleId}/submit`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-active-tenant': item.tenantId,
        },
        body: JSON.stringify(item.body),
      })
      if (res.ok) {
        await removeQueuedAttempt(item.id)
        flushed += 1
        continue
      }
      // HTTP error — surface but keep the item so the user can decide
      // (e.g. quiz changed underneath them, version retired, etc.).
      const payload = await res.json().catch(() => ({}))
      await markRetried(item, typeof payload?.error === 'string' ? payload.error : `HTTP ${res.status}`)
      failed += 1
    } catch (err) {
      // Network error — re-queue silently and stop the drain. The next
      // 'online' tick will try again.
      await markRetried(item, err instanceof Error ? err.message : String(err))
      failed += 1
      break
    }
  }
  const remaining = items.length - flushed
  return { flushed, failed, remaining }
}
