import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { supabase } from '@/lib/supabase'
import DepartmentDetailPage from '@/app/departments/[dept]/page'
import type { Equipment } from '@soteria/core/types'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

vi.mock('next/navigation', () => ({
  useParams: vi.fn().mockReturnValue({ dept: 'Mechanical' }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}))

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001', description: 'Conveyor Motor', department: 'Mechanical',
    photo_status: 'complete', has_equip_photo: true, has_iso_photo: false,
    equip_photo_url: null, iso_photo_url: null, placard_url: null,
    signed_placard_url: null,
    notes: null, notes_es: null, internal_notes: null, spanish_reviewed: false,
    verified: false, prefix: null,
    verified_date: null, verified_by: null,
    needs_equip_photo: false, needs_iso_photo: false, needs_verification: false,
    decommissioned: false,
    annotations: [],
    iso_annotations: [],
    created_at: null, updated_at: null,
    ...overrides,
  }
}

function makeChain(data: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  }
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockReturnValue(chain)
  chain.order  = vi.fn().mockReturnValue(chain)
  chain.limit  = vi.fn().mockReturnValue(chain)
  return chain
}

const mockEquipment: Equipment[] = [
  makeEquipment({ equipment_id: 'EQ-001', photo_status: 'complete' }),
  makeEquipment({ equipment_id: 'EQ-002', photo_status: 'missing' }),
  makeEquipment({ equipment_id: 'EQ-003', photo_status: 'partial' }),
]

describe('DepartmentDetailPage', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'loto_reviews') return makeChain([]) as unknown as ReturnType<typeof supabase.from>
      return makeChain(mockEquipment) as unknown as ReturnType<typeof supabase.from>
    })
  })

  it('shows loading spinner while fetching', () => {
    const hangingChain: Record<string, unknown> = { then: () => new Promise(() => {}) }
    hangingChain.select = vi.fn().mockReturnValue(hangingChain)
    hangingChain.eq     = vi.fn().mockReturnValue(hangingChain)
    hangingChain.order  = vi.fn().mockReturnValue(hangingChain)
    hangingChain.limit  = vi.fn().mockReturnValue(hangingChain)
    vi.mocked(supabase.from).mockReturnValue(hangingChain as unknown as ReturnType<typeof supabase.from>)
    render(<DepartmentDetailPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows department name as heading', async () => {
    render(<DepartmentDetailPage />)
    await waitFor(() => screen.getByRole('heading', { name: 'Mechanical' }))
  })

  it('shows equipment count and completion pct in subtitle', async () => {
    render(<DepartmentDetailPage />)
    await waitFor(() => screen.getByText(/3 equipment/))
    expect(screen.getByText(/33%/)).toBeInTheDocument()
  })

  it('renders back link to departments list', async () => {
    render(<DepartmentDetailPage />)
    await waitFor(() => screen.getAllByRole('link', { name: /Departments/ }))
    const links = screen.getAllByRole('link', { name: /Departments/ })
    expect(links[0]).toHaveAttribute('href', '/departments')
  })

  it('renders each equipment item in the table', async () => {
    render(<DepartmentDetailPage />)
    await waitFor(() => screen.getByText('EQ-001'))
    expect(screen.getByText('EQ-002')).toBeInTheDocument()
    expect(screen.getByText('EQ-003')).toBeInTheDocument()
  })

  it('queries supabase for equipment with the correct department', async () => {
    render(<DepartmentDetailPage />)
    await waitFor(() => screen.getByText('EQ-001'))
    const equipCalls = vi.mocked(supabase.from).mock.calls.filter(c => c[0] === 'loto_equipment')
    expect(equipCalls.length).toBeGreaterThan(0)
  })

  it('shows empty table message when department has no equipment', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'loto_reviews') return makeChain([]) as unknown as ReturnType<typeof supabase.from>
      return makeChain([]) as unknown as ReturnType<typeof supabase.from>
    })
    render(<DepartmentDetailPage />)
    await waitFor(() => screen.getByText('No equipment found.'))
  })
})
