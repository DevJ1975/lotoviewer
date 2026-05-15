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
})
