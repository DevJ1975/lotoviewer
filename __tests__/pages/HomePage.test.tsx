import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { supabase } from '@/lib/supabase'
import HomePage from '@/app/page'
import type { Equipment } from '@/lib/types'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null, XAxis: () => null, YAxis: () => null,
  CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
}))

function makeChain(data: Equipment[]) {
  const chain: Record<string, unknown> = {
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  }
  chain.select = vi.fn().mockReturnValue(chain)
  return chain
}

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001', description: 'Motor', department: 'Alpha',
    photo_status: 'complete', has_equip_photo: true, has_iso_photo: false,
    equip_photo_url: null, iso_photo_url: null, placard_url: null,
    notes: null, verified: false, ...overrides,
  }
}

const mockEquipment: Equipment[] = [
  makeEquipment({ equipment_id: 'EQ-001', photo_status: 'complete', department: 'Alpha' }),
  makeEquipment({ equipment_id: 'EQ-002', photo_status: 'partial',  department: 'Alpha' }),
  makeEquipment({ equipment_id: 'EQ-003', photo_status: 'missing',  department: 'Beta'  }),
]

describe('HomePage', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReturnValue(makeChain(mockEquipment) as ReturnType<typeof supabase.from>)
  })

  it('shows loading spinner while data is pending', () => {
    // Never-resolving promise to lock component in loading state
    const hangingChain = { select: vi.fn(), then: () => new Promise(() => {}) }
    hangingChain.select = vi.fn().mockReturnValue(hangingChain)
    vi.mocked(supabase.from).mockReturnValue(hangingChain as ReturnType<typeof supabase.from>)
    render(<HomePage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows "Live LOTO Status" heading after data loads', async () => {
    render(<HomePage />)
    await waitFor(() => expect(screen.getByText('Live LOTO Status')).toBeInTheDocument())
  })

  it('shows "Live" indicator', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Live'))
  })

  it('renders all four stat card labels', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Total Equipment'))
    // "Complete", "Partial", "Missing" appear in both StatsCards and the ring legend
    expect(screen.getAllByText('Complete').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Partial').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(1)
  })

  it('shows "No department data available." when equipment list is empty', async () => {
    vi.mocked(supabase.from).mockReturnValue(makeChain([]) as ReturnType<typeof supabase.from>)
    render(<HomePage />)
    await waitFor(() => screen.getByText('No department data available.'))
  })
})
