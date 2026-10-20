import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { loadPublished } = vi.hoisted(() => ({ loadPublished: vi.fn() }))
vi.mock('@/lib/strike/moduleAccess', () => ({ loadPublishedStrikeVersion: (...a: unknown[]) => loadPublished(...a) }))

import { loadKioskSession } from '@/lib/strike/kioskSession'

// The kiosk token is the only credential on the no-login player, so this
// loader is where every "is this still allowed" check has to live.

const claims = { tenantId: 't1', memberId: 'm1', moduleId: 'mod-1', issuedBy: 'lead-7', expiresAt: Date.now() + 60_000 }

function fakeAdmin(tenant: Record<string, unknown> | null) {
  const rows: Record<string, unknown> = {
    tenants: tenant,
    members: { id: 'm1', tenant_id: 't1', display_name: 'Ana Ruiz', preferred_name: null, status: 'active' },
    strike_modules: { id: 'mod-1', title: 'LOTO 101', description: null },
    strike_module_versions: [{ id: 'ver-1', locale: 'en', version_number: 1 }],
  }
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: rows[table], error: null })
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve)
      return chain
    },
  } as unknown as SupabaseClient
}

describe('loadKioskSession — the tenant behind the link', () => {
  loadPublished.mockResolvedValue({ ok: true, version: { id: 'ver-1', locale: 'en' } })

  it('opens the session while the tenant has STRIKE', async () => {
    const result = await loadKioskSession(fakeAdmin({ modules: { strike: true }, disabled_at: null }), claims, null)
    expect(result.ok).toBe(true)
  })

  it.each([
    ['the tenant is disabled', { modules: { strike: true }, disabled_at: '2026-10-01T00:00:00Z' }],
    ['STRIKE was turned off', { modules: { strike: false }, disabled_at: null }],
    ['the tenant is gone', null],
  ])('refuses a still-unexpired link once %s', async (_label, tenant) => {
    const result = await loadKioskSession(fakeAdmin(tenant), claims, null)
    expect(result).toMatchObject({ ok: false, status: 403 })
  })
})
