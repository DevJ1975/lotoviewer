import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMeterReader, meterReaderSupported } from '@/lib/meterReader'

// We can't end-to-end test the real Bluetooth path in jsdom (no
// navigator.bluetooth, no BLE stack, no user gesture). Instead these
// tests cover:
//   - the factory's platform-aware dispatch
//   - the demo provider's reading shape + jitter range
//   - graceful close + reuse safety

describe('meterReaderSupported', () => {
  const original = (globalThis.navigator as Navigator & { bluetooth?: unknown }).bluetooth
  afterEach(() => {
    // Reset back to whatever jsdom started with so other suites are
    // unaffected.
    if (original === undefined) {
      delete (globalThis.navigator as { bluetooth?: unknown }).bluetooth
    } else {
      (globalThis.navigator as { bluetooth?: unknown }).bluetooth = original
    }
  })

  it('returns false in jsdom (no navigator.bluetooth)', () => {
    delete (globalThis.navigator as { bluetooth?: unknown }).bluetooth
    expect(meterReaderSupported()).toBe(false)
  })

  it('returns true when navigator.bluetooth is an object', () => {
    (globalThis.navigator as { bluetooth?: unknown }).bluetooth = {
      requestDevice: () => Promise.resolve({}),
    }
    expect(meterReaderSupported()).toBe(true)
  })

  it('returns false when navigator.bluetooth is null', () => {
    (globalThis.navigator as { bluetooth?: unknown }).bluetooth = null
    expect(meterReaderSupported()).toBe(false)
  })
})

describe('createMeterReader', () => {
  it("returns the demo reader for kind='demo'", () => {
    const r = createMeterReader('demo')
    expect(r).not.toBeNull()
    expect(r?.name).toBe('Demo meter')
  })

  it("returns null for kind='auto' when bluetooth unsupported", () => {
    delete (globalThis.navigator as { bluetooth?: unknown }).bluetooth
    expect(createMeterReader('auto')).toBeNull()
    expect(createMeterReader('bluetooth-generic')).toBeNull()
  })

  it("returns a bluetooth reader for kind='auto' when supported", () => {
    (globalThis.navigator as { bluetooth?: unknown }).bluetooth = { requestDevice: () => Promise.resolve({}) }
    const r = createMeterReader('auto')
    expect(r).not.toBeNull()
    expect(r?.name).toMatch(/BLE/i)
    delete (globalThis.navigator as { bluetooth?: unknown }).bluetooth
  })
})

describe('DemoMeterReader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a Reading with all four channels populated', async () => {
    const r = createMeterReader('demo')!
    const p = r.connect()
    await vi.runAllTimersAsync()
    const reading = await p
    expect(reading.o2_pct).not.toBeNull()
    expect(reading.lel_pct).not.toBeNull()
    expect(reading.h2s_ppm).not.toBeNull()
    expect(reading.co_ppm).not.toBeNull()
    expect(reading.instrument_id).toBe('DEMO-001')
    expect(reading.sampledAt).toBeGreaterThan(0)
  })

  it('returns plausible O₂ around 20.9% (±0.4 jitter)', async () => {
    // Demo readings should LOOK like a healthy atmosphere — 20.9% baseline
    // with small jitter. A test that ran on a live confined-space permit
    // page should pass thresholds without surprise.
    const r = createMeterReader('demo')!
    const p = r.connect()
    await vi.runAllTimersAsync()
    const reading = await p
    expect(reading.o2_pct).toBeGreaterThanOrEqual(20.5)
    expect(reading.o2_pct).toBeLessThanOrEqual(21.3)
  })

  it('returns LEL/H₂S/CO clamped at zero (never negative)', async () => {
    // The demo jitter is symmetric around zero for the trace gases;
    // Math.max(0, ...) clamps to zero so the reading is always plausible.
    // Run a few iterations to flush both sides of the jitter.
    for (let i = 0; i < 10; i++) {
      const r = createMeterReader('demo')!
      const p = r.connect()
      await vi.runAllTimersAsync()
      const reading = await p
      expect(reading.lel_pct).toBeGreaterThanOrEqual(0)
      expect(reading.h2s_ppm).toBeGreaterThanOrEqual(0)
      expect(reading.co_ppm).toBeGreaterThanOrEqual(0)
      await r.close()
    }
  })

  it('throws after close() — readers are single-session', async () => {
    const r = createMeterReader('demo')!
    await r.close()
    await expect(r.connect()).rejects.toThrow('closed')
  })

  it('close() is idempotent', async () => {
    const r = createMeterReader('demo')!
    await r.close()
    await r.close()  // shouldn't throw
  })

  it('rounds O₂ to 1 decimal and CO to 0 decimals', async () => {
    // The form expects parseable decimal strings. Loose precision so an
    // overlong float doesn't show up in the input.
    const r = createMeterReader('demo')!
    const p = r.connect()
    await vi.runAllTimersAsync()
    const reading = await p
    // O₂ ≈ 20.x with one decimal of precision
    const o2Str = String(reading.o2_pct)
    const decimals = (o2Str.split('.')[1] ?? '').length
    expect(decimals).toBeLessThanOrEqual(1)
    // CO is integer
    expect(Number.isInteger(reading.co_ppm)).toBe(true)
  })
})
