import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModuleGuard from '@/components/ModuleGuard'

// Mock useTenant rather than mounting the real TenantProvider — the
// provider does its own Supabase fetch, which we don't need here. We
// just exercise the guard's render branches.
const mockUseTenant = vi.fn()
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => mockUseTenant(),
}))

function tenantWith(overrides: Record<string, boolean>) {
  return {
    id:            'tenant-uuid',
    tenant_number: '0001',
    slug:          'snak-king',
    name:          'Snak King',
    status:        'active',
    is_demo:       false,
    disabled_at:   null,
    modules:       overrides,
    logo_url:      null,
    custom_domain: null,
    settings:      {},
    created_at:    '',
    updated_at:    '',
  }
}

describe('ModuleGuard', () => {
  beforeEach(() => {
    mockUseTenant.mockReset()
  })

  it('renders children optimistically while tenant is loading', () => {
    mockUseTenant.mockReturnValue({ tenant: null, loading: true })
    render(<ModuleGuard moduleId="loto"><div>protected</div></ModuleGuard>)
    expect(screen.getByText('protected')).toBeInTheDocument()
  })

  it('renders children when no tenant is available (signed-out path)', () => {
    mockUseTenant.mockReturnValue({ tenant: null, loading: false })
    render(<ModuleGuard moduleId="loto"><div>protected</div></ModuleGuard>)
    expect(screen.getByText('protected')).toBeInTheDocument()
  })

  it('renders children when the module is enabled for the active tenant', () => {
    mockUseTenant.mockReturnValue({
      tenant:  tenantWith({ loto: true }),
      loading: false,
    })
    render(<ModuleGuard moduleId="loto"><div>protected</div></ModuleGuard>)
    expect(screen.getByText('protected')).toBeInTheDocument()
  })

  it('renders the unavailable screen when the module is disabled', () => {
    mockUseTenant.mockReturnValue({
      tenant:  tenantWith({ 'confined-spaces': false }),
      loading: false,
    })
    render(
      <ModuleGuard moduleId="confined-spaces">
        <div>protected</div>
      </ModuleGuard>,
    )
    expect(screen.queryByText('protected')).not.toBeInTheDocument()
    // Surface text mentions tenant name + tenant number for support context.
    expect(screen.getByText(/Snak King/)).toBeInTheDocument()
    expect(screen.getByText(/#0001/)).toBeInTheDocument()
    // Back-link to dashboard so the user isn't stranded.
    expect(screen.getByRole('link', { name: /Back to dashboard/i })).toHaveAttribute('href', '/')
  })

  it('blocks a child route when its parent is disabled (inheritance)', () => {
    // 'cs-status-board' has parent: 'confined-spaces' in lib/features.ts.
    // Even without an explicit override on the child id, disabling the
    // parent should hide the child.
    mockUseTenant.mockReturnValue({
      tenant:  tenantWith({ 'confined-spaces': false }),
      loading: false,
    })
    render(
      <ModuleGuard moduleId="cs-status-board">
        <div>child route</div>
      </ModuleGuard>,
    )
    expect(screen.queryByText('child route')).not.toBeInTheDocument()
  })
})
