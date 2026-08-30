import { describe, expect, it } from 'vitest'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'

describe('memory rate limiter', () => {
  it('allows requests until the window limit is reached', () => {
    const key = `test:${Math.random()}`

    expect(checkMemoryRateLimit(key, 2, 60_000, 1_000)).toEqual({ ok: true })
    expect(checkMemoryRateLimit(key, 2, 60_000, 2_000)).toEqual({ ok: true })
    expect(checkMemoryRateLimit(key, 2, 60_000, 3_000)).toMatchObject({
      ok: false,
      retryAfterSec: 58,
    })
  })

  it('resets after the rate-limit window', () => {
    const key = `test:${Math.random()}`

    expect(checkMemoryRateLimit(key, 1, 1_000, 1_000)).toEqual({ ok: true })
    expect(checkMemoryRateLimit(key, 1, 1_000, 1_500).ok).toBe(false)
    expect(checkMemoryRateLimit(key, 1, 1_000, 2_100)).toEqual({ ok: true })
  })

  it('sweeps expired buckets instead of growing without bound', () => {
    // Several call sites key on a caller-supplied value, so an unswept map is
    // a slow memory-exhaustion primitive against a warm instance.
    const store = new Map()
    globalThis.__soteriaMemoryRateLimits = store

    for (let i = 0; i < 10_000; i++) {
      checkMemoryRateLimit(`sweep:${i}`, 1, 1_000, 1_000)
    }
    expect(store.size).toBe(10_000)

    // One more insert past the threshold, after every existing bucket has
    // expired, collapses the map to just the survivor.
    checkMemoryRateLimit('sweep:trigger', 1, 1_000, 50_000)
    expect(store.size).toBe(1)

    delete globalThis.__soteriaMemoryRateLimits
  })
})
