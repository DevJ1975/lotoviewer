interface Bucket {
  count:   number
  resetAt: number
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
