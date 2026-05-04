import { vi, describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock useTenant + useAuth + supabase. We exercise the pill's three
// rendering modes (loading/null, single membership = static pill,
// multiple memberships OR superadmin = clickable dropdown).

const useTenantMock = vi.fn()
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => useTenantMock(),
}))

const useAuthMock = vi.fn()
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}))

const fromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}))

import TenantHeaderPill from '@/components/TenantHeaderPill'

function tenant(overrides: Partial<{ id: string; tenant_number: string; slug: string; name: string; is_demo: boolean; logo_url: string | null }> = {}) {
  return {
    id:            overrides.id            ?? 'T1',
    tenant_number: overrides.tenant_number ?? '0001',
    slug:          overrides.slug          ?? 'snak-king',
    name:          overrides.name          ?? 'Snak King',
    status:        'active',
    is_demo:       overrides.is_demo       ?? false,
    disabled_at:   null,
    modules:       {},
    logo_url:      overrides.logo_url      ?? null,
    custom_domain: null,
    settings:      {},
    created_at:    '',
    updated_at:    '',
  }
}

describe('TenantHeaderPill', () => {
  beforeEach(() => {
    useTenantMock.mockReset()
    useAuthMock.mockReset()
    fromMock.mockReset()
  })

  it('renders nothing while loading', () => {
    useTenantMock.mockReturnValue({ tenant: null, available: [], loading: true, switchTenant: vi.fn() })
    useAuthMock.mockReturnValue({ profile: null })
    const { container } = render(<TenantHeaderPill />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when there is no active tenant', () => {
    useTenantMock.mockReturnValue({ tenant: null, available: [], loading: false, switchTenant: vi.fn() })
    useAuthMock.mockReturnValue({ profile: null })
    const { container } = render(<TenantHeaderPill />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a non-interactive pill for a single-membership non-superadmin', () => {
    useTenantMock.mockReturnValue({
      tenant:       tenant(),
      available:    [{ ...tenant(), role: 'owner' }],
      loading:      false,
      switchTenant: vi.fn(),
    })
    useAuthMock.mockReturnValue({ profile: { is_superadmin: false } })
    render(<TenantHeaderPill />)
    expect(screen.getByText('Snak King')).toBeInTheDocument()
    expect(screen.getByText('#0001')).toBeInTheDocument()
    // Trigger button has no chevron / disabled state — clicking shouldn't
    // open a menu (no role=menu in the doc).
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows the DEMO badge when tenant.is_demo is true', () => {
    useTenantMock.mockReturnValue({
      tenant:       tenant({ is_demo: true, name: 'WLS Demo', tenant_number: '0002', slug: 'wls-demo' }),
      available:    [{ ...tenant({ is_demo: true }), role: 'member' }],
      loading:      false,
      switchTenant: vi.fn(),
    })
    useAuthMock.mockReturnValue({ profile: { is_superadmin: false } })
    render(<TenantHeaderPill />)
    expect(screen.getByText('Demo')).toBeInTheDocument()
  })

  it('renders the dropdown for users with >1 membership', async () => {
    const switchTenant = vi.fn()
    useTenantMock.mockReturnValue({
      tenant:       tenant(),
      available:    [
        { ...tenant({ id: 'T1', name: 'Snak King', tenant_number: '0001', slug: 'snak-king' }), role: 'owner' },
        { ...tenant({ id: 'T2', name: 'WLS Demo',  tenant_number: '0002', slug: 'wls-demo', is_demo: true }), role: 'member' },
      ],
      loading:      false,
      switchTenant,
    })
    useAuthMock.mockReturnValue({ profile: { is_superadmin: false } })
    render(<TenantHeaderPill />)

    // Dropdown trigger is the only button visible
    const trigger = screen.getByRole('button')
    fireEvent.click(trigger)

    const menu = await screen.findByRole('menu')
    expect(menu).toBeInTheDocument()
    // Both tenants visible as options
    expect(screen.getByRole('menuitem', { name: /WLS Demo/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Snak King/ })).toBeInTheDocument()

    // Clicking the other tenant fires switchTenant + closes the menu
    fireEvent.click(screen.getByRole('menuitem', { name: /WLS Demo/ }))
    expect(switchTenant).toHaveBeenCalledWith('T2')
  })

  it('superadmin: opens dropdown, fetches all tenants, lists them', async () => {
    const allTenants = [
      tenant({ id: 'T1', name: 'Snak King', tenant_number: '0001', slug: 'snak-king' }),
      tenant({ id: 'T2', name: 'WLS Demo',  tenant_number: '0002', slug: 'wls-demo',  is_demo: true }),
      tenant({ id: 'T3', name: 'Acme Co',   tenant_number: '0003', slug: 'acme' }),
    ]
    fromMock.mockImplementation(() => ({
      select: () => ({ order: () => Promise.resolve({ data: allTenants, error: null }) }),
    }))
    useTenantMock.mockReturnValue({
      tenant:       tenant(),
      available:    [{ ...tenant(), role: 'owner' }],  // member of just one
      loading:      false,
      switchTenant: vi.fn(),
    })
    useAuthMock.mockReturnValue({ profile: { is_superadmin: true } })

    render(<TenantHeaderPill />)
    fireEvent.click(screen.getByRole('button'))

    // Header label appears on superadmin path
    expect(await screen.findByText(/Superadmin — all tenants/i)).toBeInTheDocument()

    // All 3 tenants render as menu items
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Snak King/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /WLS Demo/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /Acme Co/ })).toBeInTheDocument()
    })
  })
})
