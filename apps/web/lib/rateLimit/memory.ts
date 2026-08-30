// Per-process rate limiting.
//
// Scope, stated plainly so nobody mistakes this for a brute-force control:
// the store is a Map on globalThis, so on serverless each warm instance holds
// its own copy and a cold start resets it. The effective ceiling is therefore
// `limit × live instances`, not `limit`. It is a brake on runaway volume from
// a single caller, not a security boundary. Anything needing a hard
// cross-instance cap has to be durable — see lib/anonReport/ipThrottle.ts for
// the DB-backed shape.

interface Bucket {
  count:   number
  resetAt: number
}

// Buckets are only reclaimed when their key is next seen, so a key space the
// caller controls (an IP, a token) would otherwise grow without bound for the
// life of the instance. Sweep expired entries once the map gets large rather
// than on every call, so the common path stays O(1).
const SWEEP_THRESHOLD = 10_000

function sweepExpired(store: Map<string, Bucket>, now: number): void {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key)
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __soteriaMemoryRateLimits: Map<string, Bucket> | undefined
}

export interface MemoryRateLimitResult {
  ok:             boolean
  retryAfterSec?: number
}

export function checkMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): MemoryRateLimitResult {
  const store = globalThis.__soteriaMemoryRateLimits ?? new Map<string, Bucket>()
  globalThis.__soteriaMemoryRateLimits = store

  const current = store.get(key)
  if (!current || current.resetAt <= now) {
    if (store.size >= SWEEP_THRESHOLD) sweepExpired(store, now)
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  if (current.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    }
  }

  current.count += 1
  return { ok: true }
}
