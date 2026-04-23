import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { supabase } from '@/lib/supabase'
import HomePage from '@/app/page'
import type { Equipment } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter:       () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}))

function makeChain(data: Equipment[]) {
  const chain: Record<string, unknown> = {
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  }
  chain.select = vi.fn().mockReturnValue(chain)
  chain.order  = vi.fn().mockReturnValue(chain)
  return chain
}

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001', description: 'Motor (Main Pump)', department: 'Alpha',
    photo_status: 'complete', has_equip_photo: true, has_iso_photo: false,
    equip_photo_url: null, iso_photo_url: null, placard_url: null,
    signed_placard_url: null, notes: null, notes_es: null, spanish_reviewed: false,
    verified: false, ...overrides,
  } as Equipment
}

const mockEquipment: Equipment[] = [
  makeEquipment({ equipment_id: 'EQ-001', photo_status: 'complete', department: 'Alpha' }),
  makeEquipment({ equipment_id: 'EQ-002', photo_status: 'partial',  department: 'Alpha' }),
  makeEquipment({ equipment_id: 'EQ-003', photo_status: 'missing',  department: 'Beta'  }),
]

describe('HomePage dashboard', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReturnValue(makeChain(mockEquipment) as unknown as ReturnType<typeof supabase.from>)
  })

  it('shows loading spinner while data is pending', () => {
    const hanging: Record<string, unknown> = { then: () => new Promise(() => {}) }
    hanging.select = vi.fn().mockReturnValue(hanging)
    hanging.order  = vi.fn().mockReturnValue(hanging)
    vi.mocked(supabase.from).mockReturnValue(hanging as unknown as ReturnType<typeof supabase.from>)
    render(<HomePage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows the "All Equipment" row in the sidebar', async () => {
    render(<HomePage />)
    // Appears both in sidebar and center column header
    await waitFor(() => expect(screen.getAllByText('All Equipment').length).toBeGreaterThanOrEqual(1))
  })

  it('shows the overall progress label', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Overall Progress'))
  })

  it('lists all departments in the sidebar', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Alpha'))
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('renders stat chips Total / Done / Partial / Missing', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Total'))
    expect(screen.getByText('Done')).toBeInTheDocument()
    // "Partial" and "Missing" appear in both stat chips and status pills
    expect(screen.getAllByText('Partial').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(1)
  })

  it('renders equipment IDs in the center list', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('EQ-001'))
    expect(screen.getByText('EQ-002')).toBeInTheDocument()
    expect(screen.getByText('EQ-003')).toBeInTheDocument()
  })

  it('shows the "select equipment" placeholder in the right panel', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Select an equipment item'))
  })

  it('renders Retry button on load error', async () => {
    const errChain: Record<string, unknown> = { then: (r?: (v: unknown) => unknown) => Promise.resolve({ data: null, error: new Error('x') }).then(r) }
    errChain.select = vi.fn().mockReturnValue(errChain)
    errChain.order  = vi.fn().mockReturnValue(errChain)
    vi.mocked(supabase.from).mockReturnValue(errChain as unknown as ReturnType<typeof supabase.from>)
    render(<HomePage />)
    await waitFor(() => screen.getByText('Could not load equipment'))
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })
})
