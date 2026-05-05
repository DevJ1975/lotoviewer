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
    // 'Near-Miss Reporting' + 'Job Hazard Analysis' are coming-soon today
    expect(screen.getByText('Near-Miss Reporting')).toBeInTheDocument()
    expect(screen.getByText('Job Hazard Analysis')).toBeInTheDocument()
  })

  it('hides a coming-soon module when the tenant has explicitly opted out', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ 'near-miss': false }),
    })
    render(<ComingSoonStrip />)
    expect(screen.queryByText('Near-Miss Reporting')).not.toBeInTheDocument()
    expect(screen.getByText('Job Hazard Analysis')).toBeInTheDocument()
  })

  it('returns null when every coming-soon module is opted out', () => {
    mockUseTenant.mockReturnValue({
      tenant: tenantWith({ 'near-miss': false, jha: false }),
    })
    const { container } = render(<ComingSoonStrip />)
    expect(container.firstChild).toBeNull()
  })
})
