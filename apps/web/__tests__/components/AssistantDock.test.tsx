import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import AssistantDock from '@/components/AssistantDock'

const mockPathname = vi.fn<() => string | null>()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'user-1' }, loading: false }),
}))
vi.mock('@/lib/supabase', () => ({ supabase: {}, readActiveTenant: () => null }))
vi.mock('@/components/EquipmentScanner', () => ({ default: () => null }))
vi.mock('@/components/HazardReport', () => ({ default: () => null }))

const launcher = () => screen.queryByRole('button', { name: 'Open Soteria assistant' })

describe('AssistantDock', () => {
  beforeEach(() => mockPathname.mockReset())

  it('is available across the app', () => {
    mockPathname.mockReturnValue('/incidents')
    render(<AssistantDock />)
    expect(launcher()).toBeInTheDocument()
  })

  // A training page has its own LOTO Coach in the same corner: two assistants
  // there overlap and compete for the learner's question.
  it.each([
    '/strike/loto-101-control-hazardous-energy',
    '/train/kiosk-token',
  ])('stays out of the way of the LOTO Coach on %s', pathname => {
    mockPathname.mockReturnValue(pathname)
    render(<AssistantDock />)
    expect(launcher()).not.toBeInTheDocument()
  })

  it.each(['/strike/admin', '/strike/qr'])('still helps admins on %s, which has no coach', pathname => {
    mockPathname.mockReturnValue(pathname)
    render(<AssistantDock />)
    expect(launcher()).toBeInTheDocument()
  })
})
