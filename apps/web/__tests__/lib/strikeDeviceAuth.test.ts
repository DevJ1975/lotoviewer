import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authenticateDevice,
  formatDeviceCredential,
  hasDeviceCredential,
  newDeviceSecret,
  parseDeviceCredential,
  STRIKE_DEVICE_HEADER,
} from '@/lib/strike/deviceAuth'

const DEVICE_ID = '3f1c2b9e-7a4d-4e1b-9c2a-1b2c3d4e5f60'
const NOW = new Date('2026-10-20T18:00:00Z')

interface Rows { device: Record<string, unknown> | null; tenant: Record<string, unknown> | null }

function fakeAdmin(rows: Rows) {
  const updates: Record<string, unknown>[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.update = (payload: Record<string, unknown>) => { updates.push(payload); return chain }
      chain.maybeSingle = async () => ({ data: table === 'strike_devices' ? rows.device : rows.tenant, error: null })
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve)
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, updates }
}

function request(credential: string | null) {
  return new Request('http://x/api/strike/offline/sync', { headers: credential ? { [STRIKE_DEVICE_HEADER]: credential } : {} })
}

function enrolled(overrides: Record<string, unknown> = {}) {
  const { secret, hash } = newDeviceSecret()
  const device = {
    id: DEVICE_ID, tenant_id: 't1', name: 'Line 3 tablet', department: 'Packaging', site_label: null,
    secret_hash: hash, enrolled_by: 'admin-1', revoked_at: null, last_seen_at: null, ...overrides,
  }
  return { secret, device }
}

const tenantOn = { modules: { strike: true }, disabled_at: null }

describe('device credentials', () => {
  it('round-trips, and a stored hash cannot be turned back into a usable secret', () => {
    const { secret, hash } = newDeviceSecret()
    expect(parseDeviceCredential(formatDeviceCredential(DEVICE_ID, secret))).toEqual({ deviceId: DEVICE_ID, secret })
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(parseDeviceCredential(formatDeviceCredential(DEVICE_ID, hash))).not.toEqual({ deviceId: DEVICE_ID, secret })
  })

  it('refuses malformed credentials', () => {
    expect(parseDeviceCredential(null)).toBeNull()
    expect(parseDeviceCredential('no-dot')).toBeNull()
    expect(parseDeviceCredential(`not-a-uuid.${'a'.repeat(43)}`)).toBeNull()
    expect(parseDeviceCredential(`${DEVICE_ID}.short`)).toBeNull()
  })

  it('generates a different secret every time', () => {
    expect(newDeviceSecret().secret).not.toBe(newDeviceSecret().secret)
  })

  it('sees a device header, however malformed, so a bad credential never falls back to a bearer token', () => {
    expect(hasDeviceCredential(request('garbage'))).toBe(true)
    expect(hasDeviceCredential(request(null))).toBe(false)
  })
})

describe('authenticateDevice', () => {
  it('accepts the right secret and returns the device with its roster scope', async () => {
    const { secret, device } = enrolled()
    const { admin } = fakeAdmin({ device, tenant: tenantOn })
    const result = await authenticateDevice(admin, request(formatDeviceCredential(DEVICE_ID, secret)), NOW)
    expect(result).toEqual({
      ok: true,
      device: { id: DEVICE_ID, tenantId: 't1', name: 'Line 3 tablet', department: 'Packaging', siteLabel: null, enrolledBy: 'admin-1' },
    })
  })

  it('gives an unknown device and a wrong secret the same answer', async () => {
    const { device } = enrolled()
    const wrong = await authenticateDevice(fakeAdmin({ device, tenant: tenantOn }).admin, request(formatDeviceCredential(DEVICE_ID, 'x'.repeat(43))), NOW)
    const unknown = await authenticateDevice(fakeAdmin({ device: null, tenant: tenantOn }).admin, request(formatDeviceCredential(DEVICE_ID, 'x'.repeat(43))), NOW)
    expect(wrong).toEqual(unknown)
    expect(wrong).toMatchObject({ ok: false, status: 401, code: 'device_unrecognised' })
  })

  it('tells only a caller who proved the secret that the device was revoked', async () => {
    const { secret, device } = enrolled({ revoked_at: '2026-10-01T00:00:00Z' })
    const { admin } = fakeAdmin({ device, tenant: tenantOn })
    expect(await authenticateDevice(admin, request(formatDeviceCredential(DEVICE_ID, secret)), NOW)).toMatchObject({ ok: false, status: 401, code: 'device_revoked' })
    expect(await authenticateDevice(admin, request(formatDeviceCredential(DEVICE_ID, 'y'.repeat(43))), NOW)).toMatchObject({ code: 'device_unrecognised' })
  })

  it('refuses a device whose tenant is disabled or has STRIKE switched off', async () => {
    const { secret, device } = enrolled()
    const credential = formatDeviceCredential(DEVICE_ID, secret)
    for (const tenant of [{ modules: { strike: true }, disabled_at: '2026-10-01T00:00:00Z' }, { modules: { strike: false }, disabled_at: null }, null]) {
      expect(await authenticateDevice(fakeAdmin({ device, tenant }).admin, request(credential), NOW)).toMatchObject({ ok: false, status: 403, code: 'strike_unavailable' })
    }
  })

  it('records a heartbeat at most once a minute', async () => {
    const { secret, device } = enrolled({ last_seen_at: null })
    const credential = formatDeviceCredential(DEVICE_ID, secret)
    const first = fakeAdmin({ device, tenant: tenantOn })
    await authenticateDevice(first.admin, request(credential), NOW)
    expect(first.updates).toEqual([{ last_seen_at: NOW.toISOString() }])

    const recent = fakeAdmin({ device: { ...device, last_seen_at: new Date(NOW.getTime() - 30_000).toISOString() }, tenant: tenantOn })
    await authenticateDevice(recent.admin, request(credential), NOW)
    expect(recent.updates).toEqual([])
  })
})
