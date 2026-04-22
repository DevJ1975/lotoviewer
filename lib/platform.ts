// Cross-browser wrappers around modern web-platform APIs used by the app.
// Feature-detected so safe to call on any browser — non-supporting platforms
// are silent no-ops.

// ─────────────────────────────────────────────────────────────────────────────
// Persistent storage
// ─────────────────────────────────────────────────────────────────────────────
// Asks the browser not to evict our IndexedDB / Cache Storage when the OS is
// under storage pressure. Protects the offline upload queue from vanishing.
// Called once per session; Chrome / Firefox / Safari all implement it. The
// browser decides whether to grant based on engagement heuristics — prompts
// are rare, so calling this doesn't bother users.
let persistRequested = false

export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) return false
  persistRequested = true
  try {
    if (typeof navigator === 'undefined') return false
    const storage = navigator.storage
    if (!storage || typeof storage.persist !== 'function') return false
    if (typeof storage.persisted === 'function' && await storage.persisted()) return true
    return await storage.persist()
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wake Lock
// ─────────────────────────────────────────────────────────────────────────────
// Keeps the screen on during a long-running task (PDF generation, photo
// capture, signing). Automatically released when the returned cleanup is
// called OR when the tab loses visibility — we re-acquire on visibilitychange
// so the lock survives phone call / app switch / notification pulls.
export interface WakeLockHandle {
  release: () => Promise<void>
}

type WakeLockSentinel = { released: boolean; release: () => Promise<void> }
interface WakeLockApi { request: (type: 'screen') => Promise<WakeLockSentinel> }

export async function acquireWakeLock(): Promise<WakeLockHandle | null> {
  if (typeof navigator === 'undefined') return null
  const wl = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock
  if (!wl) return null

  let sentinel: WakeLockSentinel | null = null
  let released = false

  const acquire = async () => {
    if (released) return
    try { sentinel = await wl.request('screen') } catch { sentinel = null }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !released && (!sentinel || sentinel.released)) {
      acquire()
    }
  }

  await acquire()
  if (!sentinel) return null
  document.addEventListener('visibilitychange', onVisibility)

  return {
    release: async () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibility)
      try { await sentinel?.release() } catch { /* already released */ }
    },
  }
}
