import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Platform utilities are feature-detected singletons. These specs cover the
// silent no-op contract on unsupported browsers and the happy path on
// browsers that implement the APIs.

describe('haptic', () => {
  let originalNavigator: Navigator | undefined

  beforeEach(() => {
    originalNavigator = globalThis.navigator
  })

  afterEach(() => {
    if (originalNavigator) globalThis.navigator = originalNavigator
    vi.resetModules()
  })

  it('is a silent no-op when navigator.vibrate is missing', async () => {
    vi.stubGlobal('navigator', {})
    const { haptic } = await import('@/lib/platform')
    expect(() => haptic('tap')).not.toThrow()
  })

  it('calls navigator.vibrate with the tap pattern', async () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    const { haptic } = await import('@/lib/platform')
    haptic('tap')
    expect(vibrate).toHaveBeenCalledWith(10)
  })

  it('maps success to a multi-segment pattern', async () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    const { haptic } = await import('@/lib/platform')
    haptic('success')
    expect(vibrate).toHaveBeenCalledWith([10, 40, 10])
  })

  it('maps error to a longer emphasis pattern', async () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    const { haptic } = await import('@/lib/platform')
    haptic('error')
    expect(vibrate).toHaveBeenCalledWith([30, 50, 30])
  })

  it('swallows exceptions thrown by vibrate', async () => {
    const vibrate = vi.fn(() => { throw new Error('not allowed') })
    vi.stubGlobal('navigator', { vibrate })
    const { haptic } = await import('@/lib/platform')
    expect(() => haptic('tap')).not.toThrow()
  })
})

describe('requestPersistentStorage', () => {
  afterEach(() => { vi.resetModules() })

  it('returns false when navigator.storage is missing', async () => {
    vi.stubGlobal('navigator', {})
    const { requestPersistentStorage } = await import('@/lib/platform')
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('returns true if already persisted without calling persist()', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      storage: { persist, persisted: vi.fn(async () => true) },
    })
    const { requestPersistentStorage } = await import('@/lib/platform')
    const r = await requestPersistentStorage()
    expect(r).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('calls persist() when not already persisted', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      storage: { persist, persisted: vi.fn(async () => false) },
    })
    const { requestPersistentStorage } = await import('@/lib/platform')
    const r = await requestPersistentStorage()
    expect(r).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — second call returns false without re-invoking persist', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', {
      storage: { persist, persisted: vi.fn(async () => false) },
    })
    const { requestPersistentStorage } = await import('@/lib/platform')
    await requestPersistentStorage()
    const second = await requestPersistentStorage()
    expect(second).toBe(false)
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
