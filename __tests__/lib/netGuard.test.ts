import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isOffline, OFFLINE_WRITE_MESSAGE } from '@/lib/netGuard'

// `isOffline` returns true ONLY when navigator.onLine is explicitly false.
// Two failure modes the helper must handle:
//   1. Server-side render — `navigator` is undefined.
//   2. Captive portal / lost Wi-Fi — `navigator.onLine === false`.
// Everything else (including weird half-states) is treated as "probably
// online" so we don't false-positive a working connection.

describe('isOffline', () => {
  let original: Navigator | undefined

  beforeEach(() => {
    original = globalThis.navigator
  })
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true, writable: true })
  })

  it('returns false when running server-side (no navigator)', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true, writable: true })
    expect(isOffline()).toBe(false)
  })

  it('returns true when navigator.onLine is explicitly false', () => {
    vi.stubGlobal('navigator', { onLine: false } as unknown as Navigator)
    expect(isOffline()).toBe(true)
    vi.unstubAllGlobals()
  })

  it('returns false when navigator.onLine is true', () => {
    vi.stubGlobal('navigator', { onLine: true } as unknown as Navigator)
    expect(isOffline()).toBe(false)
    vi.unstubAllGlobals()
  })

  it('returns false when navigator.onLine is undefined (older browsers)', () => {
    // Some embedded browsers don't expose `onLine`. The guard defaults
    // to "online" rather than blocking writes on unknowable state.
    vi.stubGlobal('navigator', {} as unknown as Navigator)
    expect(isOffline()).toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('OFFLINE_WRITE_MESSAGE', () => {
  it('is a non-empty user-facing string', () => {
    expect(typeof OFFLINE_WRITE_MESSAGE).toBe('string')
    expect(OFFLINE_WRITE_MESSAGE.length).toBeGreaterThan(0)
  })

  it("mentions reconnecting so the user knows the recovery action", () => {
    // Brittle by design — if this copy ever changes, we want the test
    // to fail so a translator (or a rewrite) catches the dependency.
    expect(OFFLINE_WRITE_MESSAGE.toLowerCase()).toContain('reconnect')
  })
})
