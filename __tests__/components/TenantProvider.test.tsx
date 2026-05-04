import { vi, describe, it, expect, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// Active-tenant key written by the provider; also read by the supabase
// fetch wrapper to forward as x-active-tenant.
const ACTIVE_KEY = 'soteria.activeTenantId'

// ── Mocks ──────────────────────────────────────────────────────────────────
// We stub out useAuth so the provider thinks a user is signed in, and
// stub the supabase client so the provider's fetch + lazy lookup are
// deterministic. The mocks are configurable per-test via the helpers
// below.
const useAuthMock = vi.fn()
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => useAuthMock() }))

const fromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
  ACTIVE_TENANT_KEY: ACTIVE_KEY,
}))

import { TenantProvider, useTenant } from '@/components/TenantProvider'

// Capture hook output via a render-prop component.
type TenantState = ReturnType<typeof useTenant>
let captured: TenantState | null = null
function Capture() {
  captured = useTenant()
  return null
}

function renderProvider(): ReturnType<typeof render> {
  captured = null
  return render(<TenantProvider><Capture /></TenantProvider>)
}

// Build a thenable that mocks `supabase.from('tenant_memberships').select(...).eq(...)`
// resolving to the given memberships.
function mockMemberships(rows: Array<{ role: string; tenants: { id: string; slug: string; name: string; tenant_number: string; status: string; is_demo?: boolean; disabled_at?: string | null; modules?: Record<string, boolean>; logo_url?: string | null; custom_domain?: string | null; settings?: Record<string, unknown>; created_at?: string; updated_at?: string } | null }>) {
  const filledRows = rows.map(r => ({
    role: r.role,
    tenants: r.tenants && {
      id: r.tenants.id,
      slug: r.tenants.slug,
      name: r.tenants.name,
      tenant_number: r.tenants.tenant_number,
      status: r.tenants.status,
      is_demo: r.tenants.is_demo ?? false,
      disabled_at: r.tenants.disabled_at ?? null,
      modules: r.tenants.modules ?? {},
      logo_url: r.tenants.logo_url ?? null,
      custom_domain: r.tenants.custom_domain ?? null,
      settings: r.tenants.settings ?? {},
      created_at: r.tenants.created_at ?? '',
      updated_at: r.tenants.updated_at ?? '',
    },
  }))
  fromMock.mockImplementation((table: string) => {
    if (table === 'tenant_memberships') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: filledRows, error: null }),
        }),
      }
    }
    if (table === 'tenants') {
      // Lazy lookup for non-member tenants (superadmin path) — return
      // null by default; tests that need it override with mockReturnValue.
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
        }),
      }
    }
    return {} as never
  })
}

describe('TenantProvider', () => {
  beforeEach(() => {
    sessionStorage.clear()
    fromMock.mockReset()
    useAuthMock.mockReset()
    captured = null
  })

  it('starts in a loading state when auth is loading', () => {
    useAuthMock.mockReturnValue({ userId: null, loading: true })
    mockMemberships([])
    renderProvider()
    expect(captured!.loading).toBe(true)
    expect(captured!.tenant).toBeNull()
    expect(captured!.available).toEqual([])
  })

  it('returns no tenant when the user has no memberships', async () => {
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.available).toEqual([])
    expect(captured!.tenant).toBeNull()
    expect(captured!.tenantId).toBeNull()
  })

  it('picks the only membership as the active tenant + writes ACTIVE_TENANT_KEY', async () => {
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner', tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.available).toHaveLength(1)
    expect(captured!.tenantId).toBe('T1')
    expect(captured!.tenant?.slug).toBe('snak-king')
    expect(captured!.role).toBe('owner')
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('T1')
  })

  it('respects a stored active tenant when the user has multiple memberships', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'T2')
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner',  tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
      { role: 'member', tenants: { id: 'T2', slug: 'wls-demo',  name: 'WLS Demo',  tenant_number: '0002', status: 'trial', is_demo: true } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.tenantId).toBe('T2')
    expect(captured!.role).toBe('member')
  })

  it('falls back to the first membership when stored choice is no longer valid', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'GHOST')
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner', tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.tenantId).toBe('T1')
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('T1')
  })

  it('excludes disabled tenants from `available`', async () => {
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner',  tenants: { id: 'T1', slug: 'live',     name: 'Live',     tenant_number: '0001', status: 'active' } },
      { role: 'member', tenants: { id: 'T2', slug: 'archived', name: 'Archived', tenant_number: '0002', status: 'disabled', disabled_at: new Date().toISOString() } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.available).toHaveLength(1)
    expect(captured!.available[0]!.id).toBe('T1')
  })

  it('switchTenant updates state + writes ACTIVE_TENANT_KEY', async () => {
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner',  tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
      { role: 'member', tenants: { id: 'T2', slug: 'wls-demo',  name: 'WLS Demo',  tenant_number: '0002', status: 'trial', is_demo: true } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.tenantId).toBe('T1')

    act(() => { captured!.switchTenant('T2') })
    expect(captured!.tenantId).toBe('T2')
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('T2')
  })
})
