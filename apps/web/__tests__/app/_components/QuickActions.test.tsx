import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuickActions } from '@/app/_components/QuickActions'

const mockUseTenant = vi.fn()
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => mockUseTenant(),
}))

function tenantWith(modules: Record<string, boolean>) {
  return { id: 't', tenant_number: '0001', slug: 's', name: 'S', modules } as never
}

describe('QuickActions', () => {
  beforeEach(() => mockUseTenant.mockReset())

  it('hides LOTO actions when LOTO is disabled', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ loto: false, 'confined-spaces': true }),
    })
    render(<QuickActions />)
    expect(screen.getByText('Issue Permit')).toBeInTheDocument()
    expect(screen.queryByText('Add Equipment')).not.toBeInTheDocument()
    expect(screen.queryByText('Take Photo')).not.toBeInTheDocument()
  })

  it('hides the CS action when confined-spaces is disabled', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ loto: true, 'confined-spaces': false }),
    })
    render(<QuickActions />)
    expect(screen.queryByText('Issue Permit')).not.toBeInTheDocument()
    expect(screen.getByText('Add Equipment')).toBeInTheDocument()
    expect(screen.getByText('Take Photo')).toBeInTheDocument()
  })

  it('returns null when every action is gated off', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ loto: false, 'confined-spaces': false }),
    })
    const { container } = render(<QuickActions />)
    expect(container.firstChild).toBeNull()
  })
})
