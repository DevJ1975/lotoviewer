import { vi, describe, it, expect, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

// Active-tenant key written by the provider; also read by the supabase
// fetch wrapper to forward as x-active-tenant. Hoisted because the
// vi.mock factory below references it.
const { ACTIVE_KEY, useAuthMock, fromMock } = vi.hoisted(() => ({
  ACTIVE_KEY:  'soteria.activeTenantId',
  useAuthMock: vi.fn(),
  fromMock:    vi.fn(),
}))

// ── Mocks ──────────────────────────────────────────────────────────────────
// We stub out useAuth so the provider thinks a user is signed in, and
// stub the supabase client so the provider's fetch + lazy lookup are
// deterministic. The mocks are configurable per-test via the helpers
// below.
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => useAuthMock() }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    // B3 path calls auth.signOut + redirects on tenant-disappeared.
    auth: { signOut: vi.fn().mockResolvedValue({}) },
  },
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

function tenantRow(overrides: Partial<{ id: string; slug: string; name: string; tenant_number: string; status: string; disabled_at: string | null }> = {}) {
  return {
    id:            overrides.id            ?? 'T1',
    slug:          overrides.slug          ?? 'snak-king',
    name:          overrides.name          ?? 'Snak King',
    tenant_number: overrides.tenant_number ?? '0001',
    status:        overrides.status        ?? 'active',
    disabled_at:   overrides.disabled_at   ?? null,
    is_demo:       false,
    modules:       {},
    logo_url:      null,
    custom_domain: null,
    settings:      {},
    created_at:    '',
    updated_at:    '',
  }
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

  it('B3: stored tenant gone from memberships (non-superadmin) → signs out + redirects', async () => {
    // Stub window.alert and window.location for the B3 path.
    const alertSpy  = vi.spyOn(window, 'alert').mockImplementation(() => {})
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, href: '' },
    })

    sessionStorage.setItem(ACTIVE_KEY, 'GHOST')
    useAuthMock.mockReturnValue({ userId: 'u1', profile: { is_superadmin: false }, loading: false })
    mockMemberships([
      { role: 'owner', tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
    ])
    renderProvider()
    await waitFor(() => expect(alertSpy).toHaveBeenCalled())
    // Asserts the user-facing alert + the redirect target. signOut is
    // an async call we can't easily await here; the redirect proves
    // the path executed.
    expect(window.location.href).toBe('/login')
    alertSpy.mockRestore()
  })

  it('superadmin with stored external tenant keeps it when the row is selectable', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'GHOST')
    useAuthMock.mockReturnValue({ userId: 'u1', profile: { is_superadmin: true }, loading: false })

    const memberTenant = tenantRow({ id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001' })
    const externalTenant = tenantRow({ id: 'GHOST', slug: 'acme', name: 'Acme', tenant_number: '0003' })
    fromMock.mockImplementation((table: string) => {
      if (table === 'tenant_memberships') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ role: 'owner', tenants: memberTenant }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: externalTenant }) }),
          }),
        }
      }
      return {} as never
    })

    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    await waitFor(() => expect(captured!.tenant?.id).toBe('GHOST'))
    expect(captured!.tenantId).toBe('GHOST')
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('GHOST')
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

  it('excludes tenants without a valid tenant number from `available`', async () => {
    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner',  tenants: tenantRow({ id: 'T1', slug: 'live', name: 'Live', tenant_number: '0001' }) },
      { role: 'member', tenants: tenantRow({ id: 'T2', slug: 'equipment-smoke-1', name: 'Equipment Readiness Smoke', tenant_number: '' }) },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.available).toHaveLength(1)
    expect(captured!.available[0]!.id).toBe('T1')
  })

  it('superadmin stored invalid external tenant falls back to first selectable membership', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'SMOKE')
    useAuthMock.mockReturnValue({ userId: 'u1', profile: { is_superadmin: true }, loading: false })

    const validTenant = tenantRow({ id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001' })
    const invalidExternalTenant = tenantRow({
      id:            'SMOKE',
      slug:          'equipment-smoke-1',
      name:          'Equipment Readiness Smoke',
      tenant_number: '',
    })

    fromMock.mockImplementation((table: string) => {
      if (table === 'tenant_memberships') {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ role: 'owner', tenants: validTenant }],
              error: null,
            }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: invalidExternalTenant }) }),
          }),
        }
      }
      return {} as never
    })

    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    await waitFor(() => expect(captured!.tenantId).toBe('T1'))
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('T1')
  })

  it('switchTenant writes ACTIVE_TENANT_KEY and reloads (B1)', async () => {
    // jsdom's location.reload throws by default; replace with a spy so
    // we can assert it fired without actually navigating the test page.
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy, href: '' },
    })

    useAuthMock.mockReturnValue({ userId: 'u1', loading: false })
    mockMemberships([
      { role: 'owner',  tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
      { role: 'member', tenants: { id: 'T2', slug: 'wls-demo',  name: 'WLS Demo',  tenant_number: '0002', status: 'trial', is_demo: true } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.tenantId).toBe('T1')

    act(() => { captured!.switchTenant('T2') })
    // Storage was written before reload — the next-page load picks it up.
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('T2')
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('switchTenant rejects non-membership target for non-superadmin', async () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy, href: '' },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    useAuthMock.mockReturnValue({ userId: 'u1', profile: { is_superadmin: false }, loading: false })
    mockMemberships([
      { role: 'member', tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))
    expect(captured!.tenantId).toBe('T1')

    // Programmatic attempt to switch to a tenant the user is NOT a member
    // of must be a no-op: storage stays on T1 and the page does not reload.
    act(() => { captured!.switchTenant('OTHER') })
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('T1')
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('switchTenant allows superadmin to target a non-membership tenant', async () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy, href: '' },
    })

    useAuthMock.mockReturnValue({ userId: 'u1', profile: { is_superadmin: true }, loading: false })
    mockMemberships([
      { role: 'owner', tenants: { id: 'T1', slug: 'snak-king', name: 'Snak King', tenant_number: '0001', status: 'active' } },
    ])
    renderProvider()
    await waitFor(() => expect(captured!.loading).toBe(false))

    act(() => { captured!.switchTenant('OTHER') })
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBe('OTHER')
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })
})
