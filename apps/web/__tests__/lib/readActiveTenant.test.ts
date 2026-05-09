/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readActiveTenant, ACTIVE_TENANT_KEY } from '@/lib/supabase'

// readActiveTenant is now consumed by AssistantDock, EquipmentScanner,
// HazardReport, and assistant/page after the Phase B dedupe. The
// callsites used to redefine the same body inline; the contract these
// tests pin is the behaviour they all relied on:
//   - SSR / no window  → null
//   - missing key      → null
//   - present key      → the value
//   - storage throws   → null (private mode, quota, etc.)

describe('readActiveTenant', () => {
  beforeEach(() => {
    try { window.sessionStorage.clear() } catch { /* no-op */ }
  })

  it('returns null when the key is unset', () => {
    expect(readActiveTenant()).toBeNull()
  })

  it('returns the stored tenant id', () => {
    window.sessionStorage.setItem(ACTIVE_TENANT_KEY, 'tenant-abc')
    expect(readActiveTenant()).toBe('tenant-abc')
  })

  it('returns the empty string verbatim when stored as ""', () => {
    // Implementation detail: getItem returns '' for an explicitly
    // stored empty value, NOT null. Documenting so a caller doesn't
    // assume null === unset and accidentally header-inject ''.
    window.sessionStorage.setItem(ACTIVE_TENANT_KEY, '')
    expect(readActiveTenant()).toBe('')
  })

  it('returns null when sessionStorage.getItem throws (private mode / quota)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    try {
      expect(readActiveTenant()).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('readActiveTenant — SSR', () => {
  let originalWindow: typeof globalThis.window | undefined
  beforeEach(() => {
    originalWindow = globalThis.window
    // @ts-expect-error — simulating SSR / Node-only environment
    delete globalThis.window
  })
  afterEach(() => {
    if (originalWindow) globalThis.window = originalWindow
  })

  it('returns null when window is undefined (SSR / hydration phase)', () => {
    expect(readActiveTenant()).toBeNull()
  })
})
