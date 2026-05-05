import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComingSoonStrip } from '@/app/_components/ComingSoonStrip'

const mockUseTenant = vi.fn()
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => mockUseTenant(),
}))

function tenantWith(modules: Record<string, boolean>) {
  return { id: 't', tenant_number: '0001', slug: 's', name: 'S', modules } as never
}

describe('ComingSoonStrip', () => {
  beforeEach(() => mockUseTenant.mockReset())

  it('advertises coming-soon modules by default', () => {
    mockUseTenant.mockReturnValue({ tenant: tenantWith({}) })
    render(<ComingSoonStrip />)
    // 'Job Hazard Analysis' is the last remaining coming-soon entry
    // (near-miss shipped in slice 2).
    expect(screen.getByText('Job Hazard Analysis')).toBeInTheDocument()
  })

  it('hides a coming-soon module when the tenant has explicitly opted out', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ jha: false }),
    })
    render(<ComingSoonStrip />)
    expect(screen.queryByText('Job Hazard Analysis')).not.toBeInTheDocument()
  })

  it('returns null when every coming-soon module is opted out', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ jha: false }),
    })
    const { container } = render(<ComingSoonStrip />)
    expect(container.firstChild).toBeNull()
  })
})
