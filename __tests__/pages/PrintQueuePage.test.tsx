import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { supabase } from '@/lib/supabase'
import PrintQueuePage from '@/app/print/page'
import type { Equipment } from '@/lib/types'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001', description: 'Conveyor Motor', department: 'Mech',
    photo_status: 'complete', has_equip_photo: true, has_iso_photo: false,
    equip_photo_url: null, iso_photo_url: null,
    placard_url: 'https://example.com/placard-001.pdf',
    signed_placard_url: null,
    notes: null, verified: false, ...overrides,
  }
}

function makeChain(data: Equipment[]) {
  const chain: Record<string, unknown> = {
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  }
  chain.select = vi.fn().mockReturnValue(chain)
  chain.not    = vi.fn().mockReturnValue(chain)
  chain.order  = vi.fn().mockReturnValue(chain)
  return chain
}

const mockEquipment: Equipment[] = [
  makeEquipment({ equipment_id: 'EQ-001', description: 'Conveyor Motor',  placard_url: 'https://example.com/p1.pdf' }),
  makeEquipment({ equipment_id: 'EQ-002', description: 'Air Compressor',  placard_url: 'https://example.com/p2.pdf' }),
  makeEquipment({ equipment_id: 'EQ-003', description: 'Hydraulic Pump',  placard_url: 'https://example.com/p3.pdf' }),
]

describe('PrintQueuePage', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockReturnValue(makeChain(mockEquipment) as ReturnType<typeof supabase.from>)
  })

  it('shows loading spinner while fetching', () => {
    const hangingChain: Record<string, unknown> = { then: () => new Promise(() => {}) }
    hangingChain.select = vi.fn().mockReturnValue(hangingChain)
    hangingChain.not    = vi.fn().mockReturnValue(hangingChain)
    hangingChain.order  = vi.fn().mockReturnValue(hangingChain)
    vi.mocked(supabase.from).mockReturnValue(hangingChain as ReturnType<typeof supabase.from>)
    render(<PrintQueuePage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows "Print Queue" heading after load', async () => {
    render(<PrintQueuePage />)
    await waitFor(() => screen.getByText('Print Queue'))
  })

  it('shows total placard count', async () => {
    render(<PrintQueuePage />)
    await waitFor(() => screen.getByText(/3 placards ready/))
  })

  it('renders all equipment rows', async () => {
    render(<PrintQueuePage />)
    await waitFor(() => screen.getByText('EQ-001'))
    expect(screen.getByText('EQ-002')).toBeInTheDocument()
    expect(screen.getByText('EQ-003')).toBeInTheDocument()
  })

  it('Print and Download buttons start disabled', async () => {
    render(<PrintQueuePage />)
    await waitFor(() => screen.getByText('Print Queue'))
    expect(screen.getByRole('button', { name: /Print Selected/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Download Selected/ })).toBeDisabled()
  })

  describe('selection', () => {
    it('enables action buttons after selecting one item', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      const checkboxes = screen.getAllByRole('checkbox')
      await user.click(checkboxes[1]) // [0] is select-all, [1] is first row
      expect(screen.getByRole('button', { name: /Print Selected \(1\)/ })).toBeEnabled()
    })

    it('select-all checks all filtered items', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      const selectAll = screen.getAllByRole('checkbox')[0]
      await user.click(selectAll)
      expect(screen.getByRole('button', { name: /Print Selected \(3\)/ })).toBeEnabled()
      // All row checkboxes should now be checked
      const rowCheckboxes = screen.getAllByRole('checkbox').slice(1)
      rowCheckboxes.forEach(cb => expect(cb).toBeChecked())
    })

    it('select-all unchecks all when all are selected', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      const selectAll = screen.getAllByRole('checkbox')[0]
      await user.click(selectAll) // select all
      await user.click(selectAll) // deselect all
      expect(screen.getByRole('button', { name: /Print Selected \(0\)/ })).toBeDisabled()
    })

    it('clicking a row toggles its checkbox', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      const rows = screen.getAllByRole('row').slice(1)
      await user.click(rows[0])
      const checkbox = within(rows[0]).getByRole('checkbox')
      expect(checkbox).toBeChecked()
      // click again → deselect
      await user.click(rows[0])
      expect(checkbox).not.toBeChecked()
    })
  })

  describe('search', () => {
    it('filters rows by equipment ID', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      await user.type(screen.getByPlaceholderText(/search/i), 'EQ-002')
      expect(screen.getByText('EQ-002')).toBeInTheDocument()
      expect(screen.queryByText('EQ-001')).not.toBeInTheDocument()
    })

    it('filters rows by description', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      await user.type(screen.getByPlaceholderText(/search/i), 'hydraulic')
      expect(screen.getByText('EQ-003')).toBeInTheDocument()
      expect(screen.queryByText('EQ-001')).not.toBeInTheDocument()
    })

    it('select-all after search only selects filtered items', async () => {
      const user = userEvent.setup()
      render(<PrintQueuePage />)
      await waitFor(() => screen.getByText('EQ-001'))
      await user.type(screen.getByPlaceholderText(/search/i), 'EQ-002')
      const selectAll = screen.getAllByRole('checkbox')[0]
      await user.click(selectAll)
      // Count reflects only filtered selection (1), not full 3
      expect(screen.getByRole('button', { name: /Print Selected \(1\)/ })).toBeEnabled()
    })
  })

  it('shows "No placards found." for unmatched search', async () => {
    const user = userEvent.setup()
    render(<PrintQueuePage />)
    await waitFor(() => screen.getByText('EQ-001'))
    await user.type(screen.getByPlaceholderText(/search/i), 'ZZZZZ')
    expect(screen.getByText('No placards found.')).toBeInTheDocument()
  })
})
