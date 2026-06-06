import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { supabase } from '@/lib/supabase'
import HomePage from '@/app/loto/page'
import type { Equipment } from '@soteria/core/types'

vi.mock('next/navigation', () => ({
  useRouter:       () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname:     () => '/loto',
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  },
}))

// The loto dashboard reads tenantId from TenantProvider and waits for it
// before issuing the supabase query. Without this mock the context default
// has loading=true / tenantId=null, which keeps the skeleton up forever.
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({ tenantId: 'tenant-1', loading: false }),
}))

// SessionProvider is consumed via useSession inside the dashboard for
// "recently visited" tracking. The context default no-ops are sufficient
// here; we mock the module so the real provider's sessionStorage reads
// don't interfere with the test environment.
vi.mock('@/components/SessionProvider', () => ({
  useSession: () => ({
    recents:     [],
    flags:       new Set(),
    recordVisit: vi.fn(),
    toggleFlag:  vi.fn(),
    isFlagged:   () => false,
    clearFlags:  vi.fn(),
  }),
}))

function makeChain(data: Equipment[]) {
  const chain: Record<string, unknown> = {
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  }
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockReturnValue(chain)
  chain.order  = vi.fn().mockReturnValue(chain)
  return chain
}

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001', description: 'Motor (Main Pump)', department: 'Alpha',
    photo_status: 'complete', has_equip_photo: true, has_iso_photo: false,
    equip_photo_url: null, iso_photo_url: null, placard_url: null,
    signed_placard_url: null, notes: null, notes_es: null, internal_notes: null, spanish_reviewed: false,
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
    hanging.eq     = vi.fn().mockReturnValue(hanging)
    hanging.order  = vi.fn().mockReturnValue(hanging)
    vi.mocked(supabase.from).mockReturnValue(hanging as unknown as ReturnType<typeof supabase.from>)
    render(<HomePage />)
    // DashboardSkeleton uses animate-pulse (shimmer) rather than a spinner.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
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
    // Both department names appear at least once (in the sidebar row).
    // Using getAllByText because the department name may also appear in the
    // detail panel (e.g. the placard label), so getByText would throw on
    // multiple matches.
    await waitFor(() => expect(screen.getAllByText('Alpha').length).toBeGreaterThanOrEqual(1))
    expect(screen.getAllByText('Beta').length).toBeGreaterThanOrEqual(1)
  })

  it('renders stat chips Total / Cleared / Partial / Missing', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('Total'))
    expect(screen.getByText('Cleared')).toBeInTheDocument()
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

  it('shows the "no item selected" placeholder in the right panel', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByText('No item selected'))
  })

  it('renders Retry button on load error', async () => {
    const errChain: Record<string, unknown> = { then: (r?: (v: unknown) => unknown) => Promise.resolve({ data: null, error: new Error('x') }).then(r) }
    errChain.select = vi.fn().mockReturnValue(errChain)
    errChain.eq     = vi.fn().mockReturnValue(errChain)
    errChain.order  = vi.fn().mockReturnValue(errChain)
    vi.mocked(supabase.from).mockReturnValue(errChain as unknown as ReturnType<typeof supabase.from>)
    render(<HomePage />)
    await waitFor(() => screen.getByText('Could not load equipment'))
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })
})
