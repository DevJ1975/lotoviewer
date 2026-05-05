import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModulesGrid } from '@/app/_components/ModulesGrid'

// Stub useTenant — we want to drive the visibility logic directly,
// not mount the real provider (which fetches Supabase).
const mockUseTenant = vi.fn()
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => mockUseTenant(),
}))

function tenantWith(modules: Record<string, boolean>) {
  return { id: 't', tenant_number: '0001', slug: 's', name: 'S', modules } as never
}

describe('ModulesGrid', () => {
  beforeEach(() => mockUseTenant.mockReset())

  it('renders only modules the tenant has visibility on', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ loto: true, 'confined-spaces': false, 'hot-work': false, 'risk-assessment': false }),
    })
    render(<ModulesGrid />)
    expect(screen.getByText('LOTO')).toBeInTheDocument()
    expect(screen.queryByText('Confined Spaces')).not.toBeInTheDocument()
  })

  it('returns null when no modules are visible', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({
        loto: false, 'confined-spaces': false, 'hot-work': false,
        'risk-assessment': false, 'jha': false, 'near-miss': false,
      }),
    })
    const { container } = render(<ModulesGrid />)
    expect(container.firstChild).toBeNull()
  })

  it('falls back to static enabled when tenant has no override', () => {
    mockUseTenant.mockReturnValue({ tenant: tenantWith({}) })
    render(<ModulesGrid />)
    // loto is statically enabled and not coming-soon, so it shows
    expect(screen.getByText('LOTO')).toBeInTheDocument()
  })
})
