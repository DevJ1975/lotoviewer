// Live atmospheric meter capture. The existing flow makes a tester type
// O₂ / LEL / H₂S / CO into a form by hand — this module is the plumbing
// for letting a Bluetooth meter (or any future capture source) auto-fill
// those fields instead.
//
// We deliberately use a provider abstraction rather than hard-wiring
// Web Bluetooth. The platform reality:
//   - Web Bluetooth: Chrome on Android / desktop Chrome / Edge.
//     NOT supported on iOS Safari, which is the primary tablet
//     platform per the existing app comments.
//   - iOS would need a companion native app (or BLE bridge in a Capacitor
//     wrapper) to talk to a meter. Out of scope here.
//   - For sales demos / dev / Storybook, a synthetic provider returning
//     plausible readings is way more useful than a half-working real one.
//
// So the contract is: callers ask the factory for a provider; if the
// platform supports BLE we return a real one, otherwise null. A demo
// provider is also exposed for testing flows. Each provider is a
// disposable session — call connect() to obtain a Reading, then close().

export interface Reading {
  // Match the column names on loto_atmospheric_tests so a reading can
  // be passed straight into the form / insert. Each is a number-or-null
  // because not every meter exposes every channel; a missing channel
  // simply leaves the form's input blank for the tester to fill in.
  o2_pct:        number | null
  lel_pct:       number | null
  h2s_ppm:       number | null
  co_ppm:        number | null
  // Optional metadata. instrument_id flows into the form so the tester
  // doesn't have to type it; sampledAt is set to "when the meter
  // reported the reading" so a stale reading on a freshly-connected
  // meter is detectable downstream.
  instrument_id: string | null
  sampledAt:     number             // ms since epoch
}

export interface MeterReader {
  // Identifier for logs / UI labels. Keep short.
  name: string
  // Trigger the platform's device picker (Web Bluetooth) or whatever
  // pairing flow the provider uses. Resolves with one Reading. Throws
  // if the user cancels the picker, the device disconnects mid-read,
  // or no readable characteristic is found.
  connect(): Promise<Reading>
  // Tear down whatever connection state the provider holds. Idempotent —
  // safe to call after a failed connect() or twice in a row.
  close(): Promise<void>
}

// Capability check for platform support. Used by the UI to decide
// whether to render the "Connect meter" button at all on this device.
// SSR-safe (returns false on the server).
export function meterReaderSupported(): boolean {
  if (typeof window === 'undefined') return false
  // navigator.bluetooth is the entry point; presence implies the API
  // is at least partially available. Older Edge had a partial impl;
  // we don't gate on getDevices() because it requires a permission
  // grant and we want the UI choice without prompting.
  if (typeof navigator === 'undefined') return false
  const bt = (navigator as Navigator & { bluetooth?: unknown }).bluetooth
  // typeof null is 'object' in JS — explicit null guard.
  return bt != null && typeof bt === 'object'
}

// Factory. Caller passes a kind hint; we hand back a provider that
// implements the contract. The 'auto' kind picks the best available
// provider for the current platform.
//
// Add new kinds (vendor-specific adapters) by importing them inside
// this switch and the factory will dispatch by name.
export function createMeterReader(
  kind: 'auto' | 'demo' | 'bluetooth-generic',
): MeterReader | null {
  if (kind === 'demo') {
    // Lazy-import so the synthetic data generator isn't shipped to
    // production users who don't open the demo path. The dynamic
    // import is resolved at call time; tests pass through directly.
    return new DemoMeterReader()
  }
  if (kind === 'bluetooth-generic' || kind === 'auto') {
    if (!meterReaderSupported()) return null
    return new BluetoothGenericReader()
  }
  return null
}

// ── Demo provider ─────────────────────────────────────────────────────────
//
// Returns plausible readings (O₂ ≈ 20.9%, LEL ≈ 0%, H₂S ≈ 0 ppm,
// CO ≈ 0 ppm) with a small jitter so two consecutive demo readings
// don't look suspiciously identical. The 250 ms latency simulates a
// real BLE connect-and-read so the UI's busy state has time to render.

class DemoMeterReader implements MeterReader {
  name = 'Demo meter'
  private closed = false

  async connect(): Promise<Reading> {
    if (this.closed) throw new Error('Demo meter has been closed')
    await new Promise(r => setTimeout(r, 250))
    const jitter = (range: number) => (Math.random() - 0.5) * range
    return {
      o2_pct:        round(20.9 + jitter(0.4), 1),
      lel_pct:       round(Math.max(0, jitter(2)), 1),
      h2s_ppm:       round(Math.max(0, jitter(2)), 1),
      co_ppm:        round(Math.max(0, jitter(4)), 0),
      instrument_id: 'DEMO-001',
      sampledAt:     Date.now(),
    }
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function round(n: number, places: number): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

// ── Bluetooth (generic) provider ──────────────────────────────────────────
//
// EXPERIMENTAL. Implements a generic GATT service contract that vendors
// can adopt OR that a thin BLE bridge module can republish in front of a
// meter that uses a vendor-specific protocol. The contract:
//
//   Service UUID:       0000ABCD-soteria-field-meter-2026
//   Characteristic A:   the latest reading as a JSON UTF-8 string with the
//                       Reading shape above, minus sampledAt (we set it
//                       client-side from when the read returned).
//
// Vendor-specific adapters (BW MicroClip, MSA Altair, RAE QRAE) need their
// own classes here — they have proprietary UUIDs and binary formats that
// we'd need to reverse from each vendor's SDK. Document those once we
// have hardware to test with; the generic adapter exists so we don't ship
// a half-working one.

const SOTERIA_METER_SERVICE_UUID = '0000abcd-1971-4801-8d3a-50455243d7d4'
const SOTERIA_METER_READING_UUID = '0000abce-1971-4801-8d3a-50455243d7d4'

interface BluetoothNav extends Navigator {
  bluetooth: {
    requestDevice(opts: {
      filters?: Array<{ services?: string[]; namePrefix?: string }>
      optionalServices?: string[]
      acceptAllDevices?: boolean
    }): Promise<BluetoothDevice>
  }
}

interface BluetoothDevice {
  id:    string
  name?: string
  gatt?: {
    connect(): Promise<BluetoothRemoteGATTServer>
    disconnect(): void
    connected: boolean
  }
}

interface BluetoothRemoteGATTServer {
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTCharacteristic {
  readValue(): Promise<DataView>
}

class BluetoothGenericReader implements MeterReader {
  name = 'Soteria-compatible meter (BLE)'
  private device: BluetoothDevice | null = null

  async connect(): Promise<Reading> {
    if (!meterReaderSupported()) throw new Error('Bluetooth not supported on this device')
    const nav = navigator as BluetoothNav
    // Triggers the OS device picker. The user MUST tap a device or
    // cancel — we can't pick programmatically (security boundary).
    // Filtering by service UUID hides random unrelated BLE peripherals.
    this.device = await nav.bluetooth.requestDevice({
      filters: [{ services: [SOTERIA_METER_SERVICE_UUID] }],
    })
    if (!this.device.gatt) throw new Error('Selected device exposes no GATT server')

    const server  = await this.device.gatt.connect()
    const service = await server.getPrimaryService(SOTERIA_METER_SERVICE_UUID)
    const chr     = await service.getCharacteristic(SOTERIA_METER_READING_UUID)
    const value   = await chr.readValue()

    // Decode the JSON payload. We accept tolerantly — missing channels
    // are null, unknown fields ignored. Empty / non-UTF-8 / non-JSON
    // payloads throw, which the UI surfaces.
    const text = new TextDecoder('utf-8').decode(value.buffer)
    let parsed: Partial<Omit<Reading, 'sampledAt'>>
    try { parsed = JSON.parse(text) }
    catch { throw new Error('Meter reply was not valid JSON') }

    return {
      o2_pct:        numOrNull(parsed.o2_pct),
      lel_pct:       numOrNull(parsed.lel_pct),
      h2s_ppm:       numOrNull(parsed.h2s_ppm),
      co_ppm:        numOrNull(parsed.co_ppm),
      instrument_id: typeof parsed.instrument_id === 'string' ? parsed.instrument_id : null,
      sampledAt:     Date.now(),
    }
  }

  async close(): Promise<void> {
    if (this.device?.gatt?.connected) {
      try { this.device.gatt.disconnect() }
      catch { /* ignore disconnect errors during teardown */ }
    }
    this.device = null
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
